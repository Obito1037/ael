import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // These checks operate only on browser fixtures, never native user data.
  await page.route("**/*", route => {
    const address = new URL(route.request().url());
    return ["127.0.0.1", "localhost"].includes(address.hostname) || address.protocol === "blob:"
      ? route.continue() : route.abort();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "开始一件事", exact: true })).toBeVisible();
  expect(await page.evaluate(() => typeof (window as any).__TAURI_INTERNALS__)).toBe("undefined");
});

async function downloadFixture(page: Page, kind: "brief" | "adrs" | "handover") {
  const received = page.waitForEvent("download");
  const result = await page.evaluate(async (exportKind) => {
    const entry = performance.getEntriesByType("resource").filter(item => new URL(item.name).pathname === "/src/lib/ipc.ts").at(-1);
    if (!entry) throw new Error("IPC module was not loaded");
    const { ipc } = await import(/* @vite-ignore */ entry.name);
    if (exportKind === "brief") return ipc.exportBrief("T-0417");
    if (exportKind === "adrs") return ipc.exportAdrs("T-0417");
    return ipc.exportHandover("T-0417", { events: true, skills: true, failures: true });
  }, kind);
  const download = await received;
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  return { filename: download.suggestedFilename(), contents: await readFile(path!, "utf8"), result };
}

test("browser Review export downloads an actual simulation-marked Markdown file", async ({ page }) => {
  const { filename, contents, result } = await downloadFixture(page, "brief");
  expect(filename).toBe("ael-demo-brief-T-0417.md");
  expect(contents).toContain("simulation: true");
  expect(contents).toContain("source: browser-demo");
  expect(contents).toContain("T-0417");
  expect(contents).toContain("## 验证记录");
  expect((result as { path: string }).path).toContain("已发起浏览器下载");
  expect((result as { path: string }).path).not.toContain("~/.ael");
});

test("browser ADR export downloads the real decision contents in one bundle", async ({ page }) => {
  const { filename, contents, result } = await downloadFixture(page, "adrs");
  expect(filename).toBe("ael-demo-decisions-T-0417.md");
  expect(contents).toContain("simulation: true");
  expect(contents).toContain("ADR-0023");
  expect(contents).toContain("链接器探测下沉到 build.rs");
  expect(Array.isArray(result)).toBe(true);
  expect((result as string[])[0]).toContain("已发起浏览器下载");
});

test("browser handover exports readable simulation JSON rather than pretending to write a ZIP", async ({ page }) => {
  const { filename, contents } = await downloadFixture(page, "handover");
  expect(filename).toBe("ael-demo-handover-T-0417.json");
  const data = JSON.parse(contents);
  expect(data.simulation).toBe(true);
  expect(data.source).toBe("browser-demo");
  expect(data.task.id).toBe("T-0417");
  expect(data.events.length).toBeGreaterThan(0);
  expect(data.notice).toContain("不是桌面版 handover.zip");
});

test("browser database backup and desktop ZIP import reject explicitly", async ({ page }) => {
  const errors = await page.evaluate(async () => {
    const entry = performance.getEntriesByType("resource").filter(item => new URL(item.name).pathname === "/src/lib/ipc.ts").at(-1)!;
    const { ipc } = await import(/* @vite-ignore */ entry.name);
    const messages = [];
    for (const operation of [() => ipc.backupNow(), () => ipc.importHandover("fixture-handover.zip")]) {
      try { await operation(); messages.push("unexpected success"); }
      catch (error) { messages.push(error instanceof Error ? error.message : String(error)); }
    }
    return messages;
  });
  expect(errors[0]).toContain("无法备份本地数据库");
  expect(errors[0]).toContain("桌面应用");
  expect(errors[1]).toContain("不支持导入交接包");
});

test("compact Settings keeps useful export controls without duplicate Agent settings", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(async () => {
    const entry = performance.getEntriesByType("resource").filter(item => new URL(item.name).pathname === "/src/store.ts").at(-1)!;
    const { useStore } = await import(/* @vite-ignore */ entry.name);
    useStore.getState().setView("settings");
  });
  await expect(page.locator("main h1")).toHaveText("设置");
  await expect(page.locator("main").getByRole("button", { name: "运行自检", exact: true })).toHaveCount(0);
  await expect(page.locator("main").getByRole("button", { name: "Agents", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "立即备份", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "下载演示交接数据", exact: true })).toBeEnabled();
  await expect(page.locator("main")).toContainText("除外观外，设置仅在本次预览中生效");
  await expect(page.locator("main")).toContainText("浏览器无法访问本地数据库");
  await expect(page.locator("main")).toContainText("该文件用于阅读，不是桌面交接 ZIP");
  await expect(page.locator("main").getByText("已连接", { exact: true })).toHaveCount(0);
  await expect(page.locator("main").getByText("本次已生成", { exact: true })).toHaveCount(0);
  expect(await page.locator("main").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await testInfo.attach("settings-browser-copy", { body: await page.locator("main").innerText(), contentType: "text/plain" });
});
