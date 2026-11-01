import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/terminalWriter.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});
const { TerminalWriter, replayTerminalChunks } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

let sequence = 0;
const frames = new Map();
globalThis.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
const nextFrame = () => {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach(callback => callback(0));
};

test('large output respects parser backpressure and per-frame size', () => {
  const writes = [];
  const completions = [];
  const writer = new TerminalWriter((text, done) => { writes.push(text); completions.push(done); }, () => {});
  writer.enqueue('x'.repeat(200_000));
  nextFrame();
  nextFrame();
  assert.equal(writes.length, 1, 'a busy parser must not receive another batch');
  while (completions.length) { completions.shift()(); nextFrame(); }
  assert.equal(writes.join(''), 'x'.repeat(200_000));
  assert.ok(writes.every(text => text.length <= 65_536));
  writer.dispose();
});

test('switching sessions clears old queued output only after the active write completes', () => {
  const events = [];
  let complete;
  const writer = new TerminalWriter((text, done) => { events.push(text); complete = done; }, () => events.push('RESET'));
  writer.enqueue('OLD');
  nextFrame();
  writer.enqueue('OLD QUEUED');
  writer.reset();
  writer.enqueue('NEW');
  nextFrame();
  assert.deepEqual(events, ['OLD']);
  complete();
  nextFrame();
  assert.deepEqual(events, ['OLD', 'RESET', 'NEW']);
  writer.dispose();
});

test('an unbounded producer is folded with an explicit notice and bounded memory', () => {
  const output = [];
  let complete;
  const writer = new TerminalWriter((text, done) => { output.push(text); complete = done; }, () => {});
  for (let index = 0; index < 3_000; index += 1) writer.enqueue('x'.repeat(1_000));
  nextFrame();
  while (complete) {
    const done = complete;
    complete = undefined;
    done();
    nextFrame();
  }
  assert.match(output.join(''), /折叠/);
  assert.ok(output.join('').length < 2_230_000);
  assert.ok(output.every(text => text.length <= 65_536));
  writer.dispose();
});

test('disposal cancels scheduled work and ignores late parser callbacks', () => {
  const writes = [];
  let complete;
  const writer = new TerminalWriter((text, done) => { writes.push(text); complete = done; }, () => assert.fail('reset after disposal'));
  writer.enqueue('FIRST');
  nextFrame();
  writer.enqueue('QUEUED');
  writer.dispose();
  complete();
  writer.enqueue('LATE');
  writer.reset();
  nextFrame();
  assert.deepEqual(writes, ['FIRST']);
  assert.equal(frames.size, 0);
});

test('a bounded snapshot and concurrent live chunks replay once in sequence without copying snapshot rows', () => {
  const chunk = (seq, text = `row-${seq}`, sessionId = 'current') => ({ seq, text, sessionId, direction: 'output', createdAt: '' });
  const snapshot = Object.freeze([chunk(100), chunk(101), chunk(102)]);
  const buffered = [chunk(104), chunk(101, 'duplicate'), chunk(99), chunk(103), chunk(105, 'foreign', 'other')];
  const replayed = [];
  replayTerminalChunks(snapshot, buffered, 'current', row => replayed.push(row));
  assert.deepEqual(replayed.map(row => row.seq), [99, 100, 101, 102, 103, 104]);
  assert.equal(replayed[2].text, 'row-101', 'overlapping live updates must not duplicate or replace snapshot output');
  assert.equal(replayed[1], snapshot[0], 'snapshot row references should be reused');
});

test('the maximum snapshot and live buffer both fit with system-message formatting', () => {
  const output = [];
  let complete;
  const writer = new TerminalWriter((text, done) => { output.push(text); complete = done; }, () => {});
  const formatted = text => `\x1b[38;5;208m${text}\x1b[0m`;
  for (let index = 0; index < 1_000; index += 1) writer.enqueue(formatted('s'.repeat(1_048)));
  for (let index = 0; index < 2_048; index += 1) writer.enqueue(formatted('l'.repeat(512)));
  nextFrame();
  while (complete) {
    const done = complete;
    complete = undefined;
    done();
    nextFrame();
  }
  const text = output.join('');
  assert.doesNotMatch(text, /折叠/);
  assert.equal(text, formatted('s'.repeat(1_048)).repeat(1_000) + formatted('l'.repeat(512)).repeat(2_048));
  writer.dispose();
});
