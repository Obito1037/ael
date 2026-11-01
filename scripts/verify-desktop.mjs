import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A real WebView2/Tauri check. The app gets a fresh data directory and browser
// profile; no HOME, Agent config, user database or running app is modified.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.resolve(process.argv[2] || path.join(root, 'src-tauri/target/release/ael3.exe'));
if (!existsSync(executable)) throw new Error('Build the desktop executable before running this check.');
const output = path.join(root, '.artifacts', 'native-smoke', String(Date.now()));
mkdirSync(output, { recursive: true });
const port = 17731;
const endpoint = 'http://127.0.0.1:' + port;
if (await fetch(endpoint + '/json/version').then(() => true).catch(() => false)) {
  throw new Error('The dedicated verification port is already in use. No app was started.');
}
const dataDir = path.join(output, 'data');
const child = spawn(executable, [], {
  cwd: root, windowsHide: true, stdio: 'ignore',
  env: {
    ...process.env, AEL_DATA_DIR: dataDir,
    WEBVIEW2_USER_DATA_FOLDER: path.join(output, 'webview-profile'),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-address=127.0.0.1 --remote-debugging-port=' + port,
  },
});
let browser;
let spawnError;
child.on('error', error => { spawnError = error; });
const failures = [];
const report = { executable, dataDir, output, nativeBridge: false, createdTask: false, pageSwitches: 0, pageErrors: failures, passed: false };
try {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) throw new Error('Desktop app exited before WebView connected: ' + child.exitCode);
    if (await fetch(endpoint + '/json/version').then(r => r.ok).catch(() => false)) break;
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  browser = await chromium.connectOverCDP(endpoint, { timeout: 15000 });
  const context = browser.contexts()[0];
  let page = context.pages()[0];
  if (!page) page = await context.waitForEvent('page', { timeout: 15000 });
  page.on('pageerror', error => failures.push(error.message));
  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__), { timeout: 15000 });
  report.nativeBridge = true;
  await page.getByRole('heading', { name: '开始一件事', exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'native-home.png') });
  await page.getByLabel('任务名称', { exact: true }).fill('桌面验证任务');
  await page.getByLabel('目标', { exact: true }).fill('仅验证本地任务与页面，不运行 Agent。');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '确认并开始', exact: true }).click();
  await page.locator('main').getByText('桌面验证任务', { exact: true }).first().waitFor();
  report.createdTask = true;
  const fixture = spawnSync('python', ['-c', String.raw`
import json, sqlite3, sys
from pathlib import Path
root = Path(sys.argv[1]).resolve()
dbfile = root / 'ael.db'
assert dbfile.is_file(), 'The isolated app must initialize its own database first'
conn = sqlite3.connect(str(dbfile), timeout=10)
conn.execute('PRAGMA foreign_keys=ON')
task_id = conn.execute('SELECT id FROM tasks WHERE title=?', ('桌面验证任务',)).fetchone()[0]
stamp = '2026-01-01T00:00:00Z'
conn.execute('INSERT INTO agent_sessions(id,task_id,profile_id,agent_id,status,cwd,command_line,started_at,updated_at,ended_at,exit_code,last_seq) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
 ('native-fixture-session',task_id,'synthetic','synthetic','exited',str(root),'synthetic transcript - no process',stamp,stamp,stamp,0,5000))
conn.executemany('INSERT INTO terminal_chunks(id,session_id,seq,direction,text,created_at) VALUES(?,?,?,?,?,?)',
 (('fixture-'+str(i),'native-fixture-session',i,'output','synthetic row '+str(i)+' '+('x'*1000)+'\n',stamp) for i in range(1,5001)))
conn.commit()
print(json.dumps({'storedChunks':conn.execute('SELECT COUNT(*) FROM terminal_chunks').fetchone()[0]}))
conn.close()
`, dataDir], { windowsHide: true, encoding: 'utf8' });
  if (fixture.status !== 0) throw new Error('Synthetic native fixture failed: ' + fixture.stderr);
  report.fixture = JSON.parse(fixture.stdout);
  report.snapshot = await page.evaluate(async () => {
    const snapshot = await window.__TAURI_INTERNALS__.invoke('get_agent_snapshot', { sessionId: 'native-fixture-session' });
    return {
      chunks: snapshot.chunks.length,
      bytes: new TextEncoder().encode(snapshot.chunks.map(chunk => chunk.text).join('')).length,
      truncated: snapshot.truncated,
      firstSeq: snapshot.firstSeq,
      lastSeq: snapshot.lastSeq,
    };
  });
  if (!report.snapshot.truncated || report.snapshot.chunks > 1000 || report.snapshot.bytes > 1024 * 1024 || report.snapshot.lastSeq !== 5000) {
    throw new Error('Native snapshot did not respect transcript bounds: ' + JSON.stringify(report.snapshot));
  }
  async function navigate(label) {
    const menu = page.getByRole('button', { name: '打开导航', exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.locator('aside.nav-drawer').getByRole('button', { name: label, exact: true }).click();
    await page.locator('main').waitFor();
    report.pageSwitches += 1;
  }
  for (let cycle = 0; cycle < 4; cycle += 1) {
    await navigate('记忆');
    await page.getByRole('heading', { name: '记忆', exact: true }).waitFor();
    await page.getByRole('button', { name: '历史扫描', exact: true }).click();
    await page.getByText('本机历史扫描', { exact: true }).waitFor();
    await navigate('工作台');
    await page.getByLabel('绑定任务', { exact: true }).waitFor();
    await navigate('全部任务');
    await page.locator('main').getByText('桌面验证任务', { exact: true }).first().waitFor();
  }
  await navigate('工作台');
  await page.getByLabel('会话消息', { exact: true }).waitFor();
  await page.getByRole('button', { name: '查看会话 native-fixture-session', exact: true }).click();
  await page.getByTestId('terminal-snapshot-notice').waitFor();
  // Switch away while a large replay may still be draining, then attach again.
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await navigate('记忆');
    await page.getByRole('heading', { name: '记忆', exact: true }).waitFor();
    await navigate('工作台');
    await page.getByRole('button', { name: '查看会话 native-fixture-session', exact: true }).click();
    await page.getByTestId('terminal-snapshot-notice').waitFor();
  }
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(output, 'native-workbench.png') });
  const retained = spawnSync('python', ['-c', 'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute("SELECT COUNT(*) FROM terminal_chunks WHERE session_id=?", ("native-fixture-session",)).fetchone()[0]); c.close()', path.join(dataDir, 'ael.db')], { windowsHide: true, encoding: 'utf8' });
  report.retainedChunks = Number(retained.stdout?.trim());
  if (retained.status !== 0 || report.retainedChunks !== 5000) throw new Error('Transcript evidence was not retained intact.');

  const workspaceCounts = () => {
    const result = spawnSync('python', ['-c', 'import json,sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(json.dumps({t:c.execute("SELECT COUNT(*) FROM "+t).fetchone()[0] for t in ("tasks","skills","failures")})); c.close()', path.join(dataDir, 'ael.db')], { windowsHide: true, encoding: 'utf8' });
    if (result.status !== 0) throw new Error('Unable to inspect isolated test database.');
    return JSON.parse(result.stdout);
  };
  const beforeDemo = workspaceCounts();
  await navigate('体验记忆复用');
  await page.getByTestId('memory-demo').waitFor();
  async function demoAction(id) {
    await page.locator('[data-demo-action="' + id + '"]').click();
  }
  for (const id of ['begin', 'select-fix:remove-spaces', 'run-verification', 'retry',
    'select-fix:argument-array', 'run-verification', 'extract-candidate', 'try-recall',
    'review-candidate', 'confirm-memory', 'select-task:changed-environment', 'search-recall',
    'choose-reuse:reuse', 'revalidate-memory:trust-history', 'revalidate-memory:sample-path',
    'apply-memory', 'verify-reuse', 'feedback:harmful', 'restore-memory']) await demoAction(id);
  await page.getByTestId('demo-summary').waitFor();
  await page.locator('main').evaluate(element => element.scrollTo({ top: 0 }));
  await page.screenshot({ path: path.join(output, 'native-memory-demo.png') });
  const nativeCDP = await context.newCDPSession(page);
  await nativeCDP.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: output, eventsEnabled: true });
  await page.getByRole('button', { name: '下载演示记忆记录', exact: true }).click();
  const exportPath = path.join(output, 'ael-memory-demo.json');
  const exportDeadline = Date.now() + 15000;
  while (!existsSync(exportPath) && Date.now() < exportDeadline) await new Promise(resolve => setTimeout(resolve, 200));
  if (!existsSync(exportPath)) throw new Error('Native demo download did not create the requested file.');
  const exported = JSON.parse(readFileSync(exportPath, 'utf8'));
  if (exported.simulation !== true) throw new Error('Demo export lacks simulation marker.');
  await page.getByRole('button', { name: '重置演示', exact: true }).click();
  await page.locator('[data-stage="prepare"]').waitFor();
  const afterDemo = workspaceCounts();
  if (JSON.stringify(beforeDemo) !== JSON.stringify(afterDemo)) throw new Error('Demo changed real workspace records.');
  report.memoryDemo = { completed: true, exportPath, simulation: exported.simulation, resetWorks: true, workspaceBefore: beforeDemo, workspaceAfter: afterDemo };

  if (failures.length) throw new Error('Native renderer errors: ' + failures.join('; '));
  if (child.exitCode !== null) throw new Error('Desktop app unexpectedly exited.');
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = String(error);
  throw error;
} finally {
  writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close().catch(() => {});
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill();
  }
}
