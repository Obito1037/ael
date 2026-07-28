import { test, expect } from "@playwright/test";

// 浏览器预览(内置 mock)下的治理层 UI 冒烟测试。
// 需要先起 dev server:pnpm dev(http://localhost:1420)。

test("治理层导航与四出口渲染", async ({ page }) => {
  await page.goto("/");

  // 侧栏与总览
  await expect(page.locator("aside")).toContainText("AEL");
  await expect(page.locator("main h1")).toHaveText("总览");

  // 出口③ 海关:命令试判器
  await page.click('aside button:has-text("海关")');
  await expect(page.locator("main h1")).toHaveText("海关裁决");
  const probe = page.getByPlaceholder("输入一条命令,预演海关裁决…");
  await probe.fill("rm -rf /");
  await page.click('main button:has-text("试判")');
  await expect(page.locator("main")).toContainText("扣留");
  await expect(page.locator("main")).toContainText("destructive_fs");

  // 出口① Review Brief
  await page.click('aside button:has-text("Review Brief")');
  await expect(page.locator("main h1")).toHaveText("Review Brief");

  // 出口② 行级溯源
  await page.click('aside button:has-text("行级溯源")');
  await expect(page.locator("main h1")).toHaveText("行级溯源");

  // 出口④ 活文档 ADR
  await page.click('aside button:has-text("活文档")');
  await expect(page.locator("main h1")).toHaveText("活文档 ADR");

  // 经验库(保鲜期)
  await page.click('aside button:has-text("经验库")');
  await expect(page.locator("main")).toContainText("保鲜");
});
