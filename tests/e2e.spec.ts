import { test, expect } from '@playwright/test';

test('Antigravity GUI Main Flow', async ({ page }) => {
  await page.goto('/');

  // 1. 新建任务 (Create Task)
  await page.click('button:has-text("新建任务")');
  await page.fill('input[placeholder*="Optimize PostgreSQL"]', 'E2E Flow Task');
  await page.fill('textarea[placeholder*="详细描述"]', 'Normal task');
  await page.click('button:has-text("确认启动")');
  await expect(page.locator('h3:has-text("E2E Flow Task")').first()).toBeVisible();

  // Click into the task
  await page.click('h3:has-text("E2E Flow Task")');

  // 2. 追加几条证据 (Append Events: error, fix)
  await page.click('button:has-text("追加证据")');
  await page.selectOption('select', 'error');
  await page.fill('input[placeholder="事件标题..."]', 'Encountered test error');
  await page.click('button:has-text("保存")');
  await expect(page.locator('span:has-text("Encountered test error")')).toBeVisible();

  await page.click('button:has-text("追加证据")');
  await page.selectOption('select', 'fix');
  await page.fill('input[placeholder="事件标题..."]', 'Fixed the error');
  await page.click('button:has-text("保存")');
  await expect(page.locator('span:has-text("Fixed the error")')).toBeVisible();

  // 3. finalize 
  await page.click('button:has-text("Finalize Task")');
  await expect(page.locator('text=任务已验证并沉淀')).toBeVisible();

  // 4. 看到沉淀的 draft Skill (Navigate to Skills tab)
  await page.click('button:has-text("返回任务列表")');
  await page.click('button:has-text("技能")');
  await expect(page.locator('h3:has-text("Draft Skill from E2E Flow Task")')).toBeVisible();

  // 5. 开一个相似任务 -> 确认 Failure Guard
  await page.click('button:has-text("任务")'); // Back to tasks
  await page.click('button:has-text("新建任务")');
  await page.fill('input[placeholder*="Optimize PostgreSQL"]', 'JSON Data processing');
  // MOCK_FAILURES tag matches "JSON"
  await page.fill('textarea[placeholder*="详细描述"]', 'Parse JSON configuration');
  await page.click('button:has-text("确认启动")');

  // Should see failure guard warning
  await expect(page.locator('text=Failure Guard 拦截')).toBeVisible();
  
  // Click again to bypass
  await page.click('button:has-text("确认启动")');
  await expect(page.locator('h3:has-text("JSON Data processing")').first()).toBeVisible();

  // 6. 导出 handover.zip
  await page.click('button:has-text("交接")'); // Global handover button in Header
  
  // Modal pops up
  await expect(page.locator('h2:has-text("导出接手包")')).toBeVisible();
  await page.click('button:has-text("导出 handover.zip")');
  
  // Toast appears
  await expect(page.locator('text=接手程序包制作完成。正在下载')).toBeVisible();
});
