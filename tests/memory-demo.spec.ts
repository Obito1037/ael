import { expect, test, type Page } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";

const pageErrors = new Map<Page, string[]>();
test.beforeEach(async ({ page }) => {
  pageErrors.set(page, []);
  page.on("pageerror", error => pageErrors.get(page)!.push(error.message));
  await page.route("**/*", route => {
    const hostname = new URL(route.request().url()).hostname;
    return ["localhost", "127.0.0.1"].includes(hostname) ? route.continue() : route.abort();
  });
});
test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

const control = (page: Page, id: string) => page.locator(`[data-demo-action="${id}"]`);
async function action(page: Page, id: string) { await control(page, id).click(); }
async function stage(page: Page, value: string) {
  await expect(page.getByTestId("memory-demo").locator(".demo-stage-panel")).toHaveAttribute("data-stage", value);
}
async function openDemo(page: Page) {
  await page.goto("/#demo");
  await expect(page.getByTestId("memory-demo")).toBeVisible();
  await stage(page, "prepare");
  expect(await page.evaluate(() => typeof (window as any).__TAURI_INTERNALS__)).toBe("undefined");
}
async function learn(page: Page) {
  await action(page, "begin");
  await action(page, "select-fix:argument-array");
  await action(page, "run-verification");
  await expect(page.getByRole("region", { name: "第一次任务的模拟验证" })).toContainText("模拟样例通过");
  await action(page, "extract-candidate");
  await action(page, "review-candidate");
  await stage(page, "review");
}
async function enableMemory(page: Page) {
  await learn(page);
  await action(page, "confirm-memory");
  await stage(page, "recall");
}
async function navigateDemoEntry(page: Page) {
  const drawer = page.locator("aside.nav-drawer");
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  if (await menu.isVisible() && !(await drawer.getAttribute("class"))?.includes("is-open")) await menu.click();
  await drawer.getByRole("button", { name: "体验记忆复用", exact: true }).click();
}
async function screenshot(page: Page, name: string) {
  await page.locator("main").evaluate(element => { element.scrollTop = 0; });
  const widths = await page.locator("main").evaluate(element => ({ width: element.clientWidth, scroll: element.scrollWidth }));
  expect(widths.scroll - widths.width, `main overflow at ${name}`).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `.artifacts/memory-demo/${name}.png`, fullPage: true });
}

test("直接进入演示、错误修复被阻止、候选不自动召回、真实点击完成学习复用及下载", async ({ page }) => {
  await openDemo(page);
  await action(page, "begin");
  await action(page, "select-fix:remove-spaces");
  await action(page, "run-verification");
  await expect(page.getByRole("region", { name: "第一次任务的模拟验证" })).toContainText("模拟样例未通过");
  await expect(control(page, "extract-candidate")).toHaveCount(0);
  await expect(page.getByTestId("demo-memory-card")).toContainText("尚未提炼");
  await action(page, "retry");
  await action(page, "select-fix:argument-array");
  await action(page, "run-verification");
  await action(page, "extract-candidate");
  await expect(page.getByTestId("demo-memory-card")).toContainText("待确认");
  await action(page, "try-recall");
  await expect(page.getByTestId("recall-result")).toContainText("尚未人工确认");
  await expect(control(page, "choose-reuse:reuse")).toHaveCount(0);
  await action(page, "review-candidate");
  await action(page, "confirm-memory");
  await action(page, "search-recall");
  await expect(page.getByTestId("recall-result")).toContainText("找到相关记忆");
  await action(page, "choose-reuse:reuse");
  await expect(control(page, "verify-reuse")).toBeDisabled();
  await action(page, "apply-memory");
  await action(page, "verify-reuse");
  await expect(page.getByRole("region", { name: "第二次任务的模拟验证" })).toContainText("模拟样例通过");
  await action(page, "feedback:helped");
  await expect(page.getByTestId("demo-summary")).toContainText("有帮助");
  const pendingDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载演示记忆记录", exact: true }).click();
  const download = await pendingDownload;
  expect(download.suggestedFilename()).toBe("ael-memory-demo.json");
  await mkdir(".artifacts/memory-demo", { recursive: true });
  await download.saveAs(".artifacts/memory-demo/demo-export.json");
  const data = JSON.parse(await readFile(".artifacts/memory-demo/demo-export.json", "utf8"));
  expect(data.simulation).toBe(true);
  expect(data.memory.status).toBe("active");
  expect(data.memory.helped).toBe(1);
  expect(data.firstTask.attempts).toBe(2);
  expect(data.reuse.verification.status).toBe("passed");
  expect(data.evaluations).toHaveLength(3);
  expect(data.logs.every((entry: { simulation: boolean }) => entry.simulation)).toBe(true);
  expect(data.evaluations.every((entry: { simulation: boolean }) => entry.simulation)).toBe(true);
});

test("Linux环境不能沿用旧证据，负反馈暂停可恢复，不相关任务不召回", async ({ page }) => {
  await openDemo(page);
  await enableMemory(page);
  await action(page, "select-task:changed-environment");
  await action(page, "search-recall");
  await expect(page.getByTestId("recall-result")).toContainText("应用前必须重验");
  await action(page, "choose-reuse:reuse");
  await expect(control(page, "apply-memory")).toBeDisabled();
  await action(page, "revalidate-memory:trust-history");
  await expect(page.getByRole("region", { name: "新环境模拟重验" })).toContainText("旧环境结果不能证明新环境适用");
  await expect(control(page, "apply-memory")).toBeDisabled();
  await action(page, "revalidate-memory:sample-path");
  await expect(control(page, "apply-memory")).toBeEnabled();
  await action(page, "apply-memory");
  await action(page, "verify-reuse");
  await action(page, "feedback:harmful");
  await expect(page.getByTestId("demo-summary")).toContainText("已暂停召回");
  await action(page, "restart-recall");
  await action(page, "search-recall");
  await expect(page.getByTestId("recall-result")).toContainText("已暂停召回");
  await action(page, "restore-memory");
  await expect(page.getByTestId("demo-memory-card")).toContainText("已启用");
  await expect(page.getByTestId("demo-memory-card").locator(".demo-memory-feedback")).toContainText("负面反馈 1");
  await action(page, "select-task:unrelated");
  await action(page, "search-recall");
  await expect(page.getByTestId("recall-result")).toContainText("不相关");
  await expect(control(page, "choose-reuse:reuse")).toHaveCount(0);
});

test("侧栏入口、跨页面保留进度，重置只清空演示状态", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "开始一件事", exact: true })).toBeVisible();
  const readRealState = () => page.evaluate(async () => {
    const resource = performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === "/src/store.ts")!;
    const { useStore } = await import(/* @vite-ignore */ resource.name);
    const state = useStore.getState();
    return JSON.stringify({ tasks: state.tasks, sessions: state.sessions, pending: state.pending, decisions: state.decisions, budgets: state.budgets, theme: state.theme });
  });
  const before = await readRealState();
  await navigateDemoEntry(page);
  await learn(page);
  await expect(page.getByTestId("demo-memory-card")).toContainText("待确认");
  await page.getByRole("button", { name: "退出演示", exact: true }).click();
  await expect(page.locator("main h1")).toHaveText("记忆");
  await navigateDemoEntry(page);
  await stage(page, "review");
  await expect(page.getByTestId("demo-memory-card")).toContainText("待确认");
  await page.getByRole("button", { name: "重置演示", exact: true }).click();
  await stage(page, "prepare");
  await expect(page.getByTestId("demo-memory-card")).toContainText("尚未提炼");
  expect(await readRealState()).toBe(before);
});

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`${viewport.width}px 各阶段可交互且主内容无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await openDemo(page);
    await screenshot(page, `${viewport.name}-prepare`);
    await learn(page);
    await screenshot(page, `${viewport.name}-review`);
    await action(page, "confirm-memory");
    await action(page, "search-recall");
    await screenshot(page, `${viewport.name}-recall`);
    await action(page, "choose-reuse:reuse");
    await action(page, "apply-memory");
    await screenshot(page, `${viewport.name}-reuse`);
    await action(page, "verify-reuse");
    await action(page, "feedback:helped");
    await stage(page, "summary");
    await screenshot(page, `${viewport.name}-summary`);
    if (viewport.name === "mobile") await page.getByTestId("demo-memory-card").screenshot({ path: ".artifacts/memory-demo/mobile-memory-card.png" });
  });
}
