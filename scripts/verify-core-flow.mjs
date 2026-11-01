import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The whole governance loop through the real desktop app, with a real PowerShell
// session instead of a model, so it needs no login or quota and suits a live demo:
// task -> session -> evidence -> gate hold/deny -> finalize -> Brief -> ADR -> Blame.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(root, 'src-tauri/target/release/ael3.exe');
if (!existsSync(executable)) throw new Error('Build the desktop executable before running this check.');
const output = path.join(root, '.artifacts', 'core-flow', String(Date.now()));
const project = path.join(output, 'project');
const dataDir = path.join(output, 'data');
mkdirSync(project, { recursive: true });
const git = (...args) => spawnSync('git', ['-c', 'user.name=ael', '-c', 'user.email=ael@local', ...args], { cwd: project, encoding: 'utf8' });
git('init', '-q');
writeFileSync(path.join(project, 'README.md'), '# demo\n');
git('add', '.');
git('commit', '-qm', 'init');

const port = 17733;
const endpoint = 'http://127.0.0.1:' + port;
if (await fetch(endpoint + '/json/version').then(() => true).catch(() => false)) {
  throw new Error('The dedicated verification port is already in use. No app was started.');
}
const child = spawn(executable, [], {
  cwd: root, windowsHide: true, stdio: 'ignore',
  env: {
    ...process.env, AEL_DATA_DIR: dataDir,
    WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview-profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + port,
  },
});

const report = { output, pageErrors: [], checks: {}, passed: false };
const check = (name, ok, detail) => {
  report.checks[name] = { ok: Boolean(ok), detail };
  console.log((ok ? '[ok]   ' : '[FAIL] ') + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
};
let browser;
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Desktop app exited before WebView connected: ' + child.exitCode);
    if (await fetch(endpoint + '/json/version').then(r => r.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.waitForEvent('page', { timeout: 15000 });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.pageErrors.push('console: ' + message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});
  const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__), { timeout: 15000 });
  const invoke = (command, args = {}) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [command, args]);
  const sql = (query, ...params) => {
    const result = spawnSync('python', ['-c', 'import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1],timeout=10); print(json.dumps(c.execute(sys.argv[2],json.loads(sys.argv[3])).fetchall(),ensure_ascii=False)); c.close()', path.join(dataDir, 'ael.db'), query, JSON.stringify(params)], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(result.stderr);
    return JSON.parse(result.stdout);
  };
  const until = async (predicate, ms = 20000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = await predicate();
      if (value) return value;
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    return null;
  };

  // 1. Task, through the same form a user fills in.
  await page.getByRole('heading', { name: '开始一件事', exact: true }).waitFor();
  await shot('1-home');
  await page.getByLabel('任务名称', { exact: true }).fill('核心流程验证');
  await page.getByLabel('目标', { exact: true }).fill('在项目中创建 hello.txt，并确认危险命令会被海关拦下。');
  const repoField = page.getByLabel('项目路径', { exact: true });
  if (await repoField.count()) await repoField.fill(project);
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认并开始', exact: true }).click();
  await page.locator('main').getByText('核心流程验证', { exact: true }).first().waitFor();
  report.landingAfterCreate = await page.getByLabel('绑定任务', { exact: true }).isVisible() ? 'workbench' : 'other';
  if (report.landingAfterCreate !== 'workbench') {
    const menu = page.getByRole('button', { name: '打开导航', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.locator('aside.nav-drawer').getByRole('button', { name: '工作台', exact: true }).click();
    await page.getByLabel('绑定任务', { exact: true }).waitFor({ timeout: 15000 });
  }
  const taskId = sql('SELECT id FROM tasks WHERE title=?', '核心流程验证')[0][0];
  check('task created', taskId);

  // 2. A real PowerShell session attached to the workbench.
  await page.getByLabel('Agent', { exact: true }).selectOption('shell');
  await page.getByLabel('工作目录', { exact: true }).fill(project);
  await page.getByRole('button', { name: /启动/ }).first().click();
  const composer = page.getByLabel('会话消息', { exact: true });
  check('session attached', await until(async () => (await page.locator('main').innerText()).includes('当前会话')));
  const send = async text => {
    await until(async () => composer.isEnabled());
    await composer.fill(text);
    await composer.press('Enter');
    await new Promise(resolve => setTimeout(resolve, 1500));
  };

  // 3. A harmless command really runs.
  await send("Set-Content -Path hello.txt -Value 'hello ael'");
  const created = await until(() => existsSync(path.join(project, 'hello.txt')));
  check('safe command executed', created, created ? readFileSync(path.join(project, 'hello.txt'), 'utf8').trim() : null);
  const sessionId = sql('SELECT id FROM agent_sessions WHERE task_id=?', taskId)[0][0];
  check('transcript persisted', await until(() => sql('SELECT COUNT(*) FROM terminal_chunks WHERE session_id=?', sessionId)[0][0] > 0));

  // 4. A destructive command is held before it reaches the shell, then blocked by a human.
  const victim = path.join(project, 'victim');
  mkdirSync(victim);
  await send('rm -rf victim');
  const pending = await until(async () => {
    const items = await invoke('gate_list_pending');
    return items.length ? items : null;
  });
  check('gate held destructive command', pending, pending && pending[0].ruleId);
  await shot('2-gate-held');
  check('held command did not run', existsSync(victim));
  if (pending) await invoke('gate_resolve_pending', { pendingId: pending[0].id, approve: false });
  const decisions = await until(() => {
    const rows = sql('SELECT rule_id, action, decided_by FROM policy_decisions');
    return rows.length ? rows : null;
  });
  check('decision recorded', decisions, decisions);
  check('denied command did not run', existsSync(victim));
  await shot('3-after-decision');

  // 5. Evidence, finalize and the outlets compiled from it.
  await invoke('append_event', { taskId, kind: 'decision', summary: '用参数数组传递路径', detail: '避免空格路径被拆分', evidenceRef: null })
    .then(() => check('decision event', true))
    .catch(error => check('decision event', false, String(error)));
  await invoke('append_event', { taskId, kind: 'verification', summary: 'hello.txt 内容正确', detail: 'hello ael', evidenceRef: null })
    .then(() => check('verification event', true))
    .catch(error => check('verification event', false, String(error)));
  await invoke('stop_agent_session', { sessionId }).catch(() => {});
  const finalize = await invoke('finalize_task', { id: taskId }).catch(error => ({ error: String(error) }));
  check('task finalized', !finalize.error, finalize.error);
  const brief = await invoke('compile_brief', { taskId }).catch(error => ({ error: String(error) }));
  check('review brief compiled', !brief.error, brief.error || Object.keys(brief).slice(0, 8));
  const adrs = await invoke('compile_adrs', { taskId }).catch(error => ({ error: String(error) }));
  check('adr compiled', !adrs.error, adrs.error || (Array.isArray(adrs) ? adrs.length : adrs));

  // 6. Commit with the AEL trailer and trace a line back to the task.
  const trailer = await invoke('generate_commit_trailer', { taskId }).catch(error => ({ error: String(error) }));
  check('commit trailer generated', !trailer.error, trailer.error || trailer);
  git('add', 'hello.txt');
  const message = ['add hello', '', trailer.trailer || ''].join('\n');
  git('commit', '-qm', message);
  const scan = await invoke('scan_repo_commits', { repoPath: project }).catch(error => ({ error: String(error) }));
  check('repo commits scanned', !scan.error, scan.error || scan);
  const blame = await invoke('blame_line', { repoPath: project, file: 'hello.txt', line: 1 }).catch(error => ({ error: String(error) }));
  check('blame traced line', !blame.error && JSON.stringify(blame).includes(taskId), blame.error || blame);

  check('no renderer errors', report.pageErrors.length === 0, report.pageErrors);
  check('app still running', child.exitCode === null);
  report.passed = Object.values(report.checks).every(item => item.ok);
  console.log(report.passed ? 'CORE FLOW PASSED' : 'CORE FLOW FAILED');
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.error = String(error);
  console.log('ERROR ' + error);
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  }
}
