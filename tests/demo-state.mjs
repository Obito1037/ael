import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/demo.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { createDemoState, transitionDemo, getDemoActions, buildDemoArtifacts } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const act = (state, type, args = {}) => transitionDemo(state, { type, ...args });
const allowed = (state, type) => getDemoActions(state).some(item => item.action.type === type && !item.disabled);
const run = (state, actions) => actions.reduce((current, action) => transitionDemo(current, typeof action === 'string' ? { type: action } : action), state);
const candidate = () => run(createDemoState(), ['begin', { type: 'select-fix', fixId: 'argument-array' }, 'run-verification', 'extract-candidate']);
const activeMemory = () => run(candidate(), ['review-candidate', 'confirm-memory']);
const reusable = () => run(activeMemory(), ['search-recall', { type: 'choose-reuse', choice: 'reuse' }, 'apply-memory', 'verify-reuse']);
const freezeDeep = value => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
};

test('transitions are deterministic and pure; out-of-order actions cannot manufacture success', () => {
  const before = freezeDeep(createDemoState());
  const first = act(before, 'begin');
  assert.notEqual(first, before);
  assert.equal(before.stage, 'prepare');
  assert.deepEqual(first, act(before, 'begin'));
  for (const type of ['extract-candidate', 'confirm-memory', 'apply-memory', 'verify-reuse', 'complete']) {
    assert.equal(act(before, type), before);
  }
  assert.equal(first.simulation, true);
  assert.equal(first.firstTask.verification.status, 'idle');
});

test('incorrect path fixes fail concrete samples and cannot produce a memory candidate', () => {
  for (const fixId of ['remove-spaces', 'hardcode-path']) {
    let state = run(createDemoState(), ['begin', { type: 'select-fix', fixId }, 'run-verification']);
    assert.equal(state.firstTask.verification.status, 'failed');
    assert.ok(state.firstTask.verification.checks.some(check => check.expected !== check.actual));
    assert.match(state.firstTask.verification.message, /恢复路线/);
    assert.equal(state.memory, null);
    assert.equal(act(state, 'extract-candidate'), state);
    state = run(state, ['retry', { type: 'select-fix', fixId: 'argument-array' }, 'run-verification', 'extract-candidate']);
    assert.equal(state.firstTask.attempts, 2);
    assert.equal(state.memory.status, 'candidate');
    assert.equal(state.evaluations.length, 2);
    assert.equal(state.evaluations[0].verification.status, 'failed');
    assert.deepEqual(state.memory.evidenceIds, [state.evaluations[1].evidenceId]);
  }
});

test('successful checks create only a candidate; explicit human confirmation is required for recall', () => {
  let state = candidate();
  assert.equal(state.memory.status, 'candidate');
  state = act(state, 'try-recall');
  assert.equal(state.recall.status, 'blocked');
  assert.match(state.recall.reason, /未人工确认/);
  assert.equal(allowed(state, 'choose-reuse'), false);
  assert.equal(act(state, 'apply-memory'), state);
  state = run(state, ['review-candidate', 'confirm-memory', 'search-recall']);
  assert.equal(state.memory.status, 'active');
  assert.equal(state.recall.status, 'matched');
  assert.equal(state.reuse.verification.status, 'idle');
});

test('rejected and unrelated memories are not recalled, while related tasks can match', () => {
  const rejected = run(candidate(), ['review-candidate', 'reject-memory', 'restart-recall', 'search-recall']);
  assert.equal(rejected.memory.status, 'rejected');
  assert.equal(rejected.recall.status, 'blocked');
  assert.equal(allowed(rejected, 'restore-memory'), false, 'rejection must not be bypassed through pause recovery');
  let state = run(activeMemory(), [{ type: 'select-task', taskId: 'unrelated' }, 'search-recall']);
  assert.equal(state.recall.status, 'blocked');
  assert.match(state.recall.reason, /不相关/);
  assert.equal(act(state, 'choose-reuse', { choice: 'reuse' }), state);
  state = run(state, [{ type: 'select-task', taskId: 'related' }, 'search-recall']);
  assert.equal(state.recall.status, 'matched');
});

test('a changed environment requires new sample evidence before applying memory', () => {
  let state = run(activeMemory(), [{ type: 'select-task', taskId: 'changed-environment' }, 'search-recall', { type: 'choose-reuse', choice: 'reuse' }]);
  assert.equal(state.memory.freshness, 'needs_revalidation');
  assert.equal(allowed(state, 'apply-memory'), false);
  assert.equal(act(state, 'apply-memory'), state);
  state = act(state, 'revalidate-memory', { method: 'trust-history' });
  assert.equal(state.reuse.revalidation.status, 'failed');
  assert.equal(state.memory.freshness, 'needs_revalidation');
  assert.equal(allowed(state, 'apply-memory'), false);
  state = act(state, 'revalidate-memory', { method: 'sample-path' });
  assert.equal(state.reuse.revalidation.status, 'passed');
  assert.equal(state.memory.freshness, 'fresh');
  assert.ok(state.memory.validatedEnvironments.includes('Linux · Bash'));
  assert.equal(state.reuse.verification.status, 'idle', 'memory revalidation is not the second task result');
  state = act(state, 'apply-memory');
  assert.equal(state.reuse.verification.status, 'idle');
  state = act(state, 'verify-reuse');
  assert.equal(state.reuse.verification.status, 'passed');
  assert.ok(state.reuse.verification.checks.every(check => check.expected.startsWith('/home/')));
});

test('harmful feedback pauses recall and recovery keeps both feedback and environment checks', () => {
  let state = act(reusable(), 'feedback', { feedback: 'harmful' });
  assert.equal(state.memory.harmful, 1);
  assert.equal(state.memory.helped, 0);
  assert.equal(state.memory.status, 'paused');
  assert.equal(act(state, 'feedback', { feedback: 'harmful' }), state, 'the same use cannot be rated twice');
  state = run(state, ['restart-recall', 'search-recall']);
  assert.equal(state.recall.status, 'blocked');
  state = run(state, [{ type: 'select-task', taskId: 'changed-environment' }, 'restore-memory', 'search-recall']);
  assert.equal(state.memory.status, 'active');
  assert.equal(state.memory.harmful, 1);
  assert.equal(state.memory.freshness, 'needs_revalidation');
  state = act(state, 'choose-reuse', { choice: 'reuse' });
  assert.equal(allowed(state, 'apply-memory'), false);
});

test('declining reuse follows a separate repair path without inventing helpful feedback', () => {
  let state = run(activeMemory(), ['search-recall', { type: 'choose-reuse', choice: 'skip' }, { type: 'select-manual-fix', fixId: 'remove-spaces' }, 'verify-reuse']);
  assert.equal(state.reuse.verification.status, 'failed');
  assert.equal(allowed(state, 'complete'), false);
  assert.equal(allowed(state, 'feedback'), false);
  state = run(state, ['retry', { type: 'select-manual-fix', fixId: 'argument-array' }, 'verify-reuse', 'complete']);
  assert.equal(state.stage, 'summary');
  assert.equal(state.reuse.attempts, 2);
  assert.equal(state.memory.helped, 0);
  assert.equal(state.memory.harmful, 0);
  assert.equal(state.evaluations.at(-1).memoryReused, false);
});

test('neutral completion does not become positive feedback; pause is reversible', () => {
  let state = act(reusable(), 'complete');
  assert.equal(state.memory.helped, 0);
  assert.equal(state.reuse.feedback, null);
  state = act(state, 'pause-memory');
  assert.equal(state.memory.status, 'paused');
  const body = state.memory.body;
  state = act(state, 'restore-memory');
  assert.equal(state.memory.status, 'active');
  assert.equal(state.memory.body, body);
  assert.equal(state.memory.harmful, 0);
});

test('export is a cloned record of the chosen branch and is explicitly simulated', () => {
  const unfinished = buildDemoArtifacts(createDemoState());
  assert.equal(unfinished.json.memory, null);
  assert.match(unfinished.handoverMarkdown, /尚未生成记忆候选/);
  assert.doesNotMatch(unfinished.reviewMarkdown, /第一次任务：模拟样例通过/);
  const state = act(reusable(), 'feedback', { feedback: 'helped' });
  const result = buildDemoArtifacts(state);
  assert.equal(result.json.simulation, true);
  assert.equal(JSON.parse(result.jsonText).memory.helped, 1);
  assert.equal(result.json.reuse.feedback, 'helped');
  assert.equal(result.json.reuse.verification.status, 'passed');
  assert.match(result.reviewMarkdown, /simulation: true/);
  assert.match(result.handoverMarkdown, /simulation: true/);
  assert.ok(result.json.logs.every(entry => entry.simulation && entry.title.startsWith('[模拟]')));
  assert.ok(result.json.evaluations.every(entry => entry.simulation && entry.verification.simulation));
  result.json.memory.helped = 100;
  assert.equal(state.memory.helped, 1, 'export consumers must not mutate active demo state');
});

test('backtracking invalidates an extracted candidate and reset starts an independent replay', () => {
  let state = candidate();
  state = act(state, 'back');
  assert.equal(state.stage, 'learn');
  assert.equal(state.memory, null);
  state = run(state, [{ type: 'select-fix', fixId: 'hardcode-path' }, 'run-verification']);
  assert.equal(state.firstTask.verification.status, 'failed');
  assert.equal(allowed(state, 'extract-candidate'), false);
  const reset = act(state, 'reset');
  assert.deepEqual(reset, createDemoState());
  assert.equal(reset.evaluations.length, 0);
  assert.equal(reset.memory, null);
});
