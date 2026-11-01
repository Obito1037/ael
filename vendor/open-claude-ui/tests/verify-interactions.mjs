import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 15431, strictPort: true } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:15431/vendor/open-claude-ui/tests/harness.html');
  const input = page.getByRole('textbox', { name: '任务内容' });
  const count = page.getByTestId('sends');
  await input.waitFor();
  assert.equal(await page.getByRole('button', { name: '发送', exact: true }).isDisabled(), true);

  await input.fill('中文输入');
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  assert.equal(await count.textContent(), '0', 'composition Enter must not submit');
  await input.dispatchEvent('compositionend');
  await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('output')?.textContent === '1');
  assert.equal(await input.inputValue(), '');

  await input.fill('first line');
  await input.press('Shift+Enter');
  await page.keyboard.insertText('Second line');
  assert.equal(await count.textContent(), '1', 'Shift+Enter must not submit');
  assert.ok((await input.inputValue()).includes('\n'), 'Shift+Enter inserts a newline');

  await page.getByRole('combobox', { name: '提交模式' }).selectOption('failure');
  await input.fill('保留失败草稿');
  await input.press('Enter');
  await page.getByRole('alert').waitFor();
  assert.equal(await input.inputValue(), '保留失败草稿');
  assert.equal(await count.textContent(), '2');

  await page.getByRole('combobox', { name: '提交模式' }).selectOption('slow');
  await input.fill('只发送一次');
  await input.press('Enter');
  await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true });
  await page.waitForFunction(() => document.querySelector('textarea')?.value === '');
  assert.equal(await count.textContent(), '3', 'in-flight duplicate sends must be ignored');
  await page.getByRole('button', { name: '切换禁用' }).click();
  assert.equal(await input.isDisabled(), true);

  const stream = page.getByTestId('stream');
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="stream"]');
    return el && el.scrollHeight - el.clientHeight - el.scrollTop < 1;
  });
  await stream.evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, bubbles: true })); el.scrollTop = 200; el.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(170);
  const before = await stream.evaluate((el) => el.scrollTop);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  await page.waitForTimeout(50);
  assert.equal(await stream.evaluate((el) => el.scrollTop), before, 'appended content must not steal manual scroll');
  await page.getByRole('button', { name: '回到底部' }).click();
  assert.ok(await stream.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop < 1));
  assert.deepEqual(errors, [], 'no uncaught browser errors');
  console.log('PASS: empty draft, CJK composition, multiline, failed draft retention, duplicate-send guard, disabled input, manual scroll preservation, explicit jump, browser errors.');
} finally {
  await browser?.close();
  await server.close();
}
