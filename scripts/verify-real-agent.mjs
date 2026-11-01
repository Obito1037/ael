import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Drives a real Agent through the desktop app, which calls a real model and uses
// that Agent's quota. The AEL data directory and the project are throwaway; the
// Agent's own login is reused and never modified.
// Usage: node scripts/verify-real-agent.mjs [codex|gemini|claude_code] [timeoutSeconds]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profileId = process.argv[2] || 'codex';
const timeoutMs = Number(process.argv[3] || 180) * 1000;
const executable = path.join(root, 'src-tauri/target/release/ael3.exe');
if (!existsSync(executable)) throw new Error('Build the desktop executable before running this check.');
const output = path.join(root, '.artifacts', 'real-agent', profileId + '-' + Date.now());
const project = path.join(output, 'project');
const dataDir = path.join(output, 'data');
mkdirSync(project, { recursive: true });
spawnSync('git', ['init', '-q'], { cwd: project });
writeFileSync(path.join(project, 'README.md'), '# demo\n');
spawnSync('git', ['add', '.'], { cwd: project });
spawnSync('git', ['-c', 'user.name=ael', '-c', 'user.email=ael@local', 'commit', '-qm', 'init'], { cwd: project });

const port = 17732;
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

const report = { profileId, output, pageErrors: [], steps: [], passed: false };
const step = message => { report.steps.push(message); console.log('[step] ' + message); };
const expected = path.join(project, 'hello.txt');
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
  const shot = name => page.screenshot({ path: path.join(output, name + '.png') });
  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__), { timeout: 15000 });
  const invoke = (command, args) => page.evaluate(([c, a]) => window.__TAURI_INTERNALS__.invoke(c, a), [command, args]);

  await page.getByRole('heading', { name: '开始一件事', exact: true }).waitFor();
  report.profiles = (await invoke('detect_agents', {})).map(p => ({ id: p.id, available: p.available, path: p.path }));
  step('profiles ' + JSON.stringify(report.profiles));

  await page.getByLabel('任务名称', { exact: true }).fill('真实 Agent 验证');
  await page.getByLabel('目标', { exact: true }).fill('在当前目录创建 hello.txt，内容为 hello ael，然后结束。不要做其他修改。');
  const repoField = page.getByLabel('项目路径', { exact: true });
  if (await repoField.count()) await repoField.fill(project);
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认并开始', exact: true }).click();
  await page.getByLabel('绑定任务', { exact: true }).waitFor({ timeout: 15000 }).catch(async () => {
    const menu = page.getByRole('button', { name: '打开导航', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.locator('aside.nav-drawer').getByRole('button', { name: '工作台', exact: true }).click();
    await page.getByLabel('绑定任务', { exact: true }).waitFor();
  });
  step('task created');

  await page.getByLabel('Agent', { exact: true }).selectOption(profileId);
  await page.getByLabel('工作目录', { exact: true }).fill(project);
  await shot('1-before-launch');
  await page.getByRole('button', { name: /启动/ }).first().click();
  step('launch clicked');

  const start = Date.now();
  let approvals = 0;
  let lastText = '';
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) throw new Error('Desktop app exited during the session: ' + child.exitCode);
    if (existsSync(expected)) break;
    const allow = page.getByRole('button', { name: '放行', exact: true });
    if (await allow.count() && await allow.first().isVisible()) {
      approvals += 1;
      step('approving gate request #' + approvals);
      await allow.first().click().catch(() => {});
    }
    const text = await page.locator('main').innerText().catch(() => '');
    if (text !== lastText) {
      lastText = text;
      const attached = !text.includes('尚未连接会话');
      if (attached !== report.attached) {
        report.attached = attached;
        step('attached=' + attached + ' at ' + Math.round((Date.now() - start) / 1000) + 's');
      }
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  report.approvals = approvals;
  report.elapsedSeconds = Math.round((Date.now() - start) / 1000);
  await new Promise(resolve => setTimeout(resolve, 3000));
  await shot('2-after-run');
  writeFileSync(path.join(output, 'main-text.txt'), lastText);

  const inspect = spawnSync('python', ['-c', String.raw`
import json, sqlite3, sys
c = sqlite3.connect(sys.argv[1], timeout=10)
c.row_factory = sqlite3.Row
out = {}
out['sessions'] = [dict(r) for r in c.execute('SELECT status, command_line, exit_code, last_seq FROM agent_sessions')]
out['events'] = [dict(r) for r in c.execute('SELECT kind, COUNT(*) n FROM task_events GROUP BY kind')]
tail = [r[0] for r in c.execute('SELECT text FROM terminal_chunks ORDER BY rowid DESC LIMIT 40')]
out['terminalTail'] = ''.join(reversed(tail))[-3000:]
print(json.dumps(out, ensure_ascii=False))
`, path.join(dataDir, 'ael.db')], { windowsHide: true, encoding: 'utf8' });
  report.database = inspect.status === 0 ? JSON.parse(inspect.stdout) : { error: inspect.stderr };

  report.fileCreated = existsSync(expected);
  report.fileContent = report.fileCreated ? readFileSync(expected, 'utf8').trim() : null;
  report.passed = report.fileCreated && report.pageErrors.length === 0;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error);
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  }
}
