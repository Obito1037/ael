import { expect, test, type Page } from "@playwright/test";

const runtimeErrors = new Map<Page, string[]>();
const externalRequests = new Map<Page, string[]>();

test.beforeEach(async ({ page }) => {
  runtimeErrors.set(page, []);
  externalRequests.set(page, []);
  page.on("pageerror", error => runtimeErrors.get(page)!.push(error.message));
  // Never call model APIs from browser regression tests.
  await page.route("**/*", route => {
    const address = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(address.hostname)) return route.continue();
    externalRequests.get(page)!.push(address.origin + address.pathname);
    return route.abort();
  });
});

test.afterEach(async ({ page }) => {
  expect(runtimeErrors.get(page)).toEqual([]);
  expect(externalRequests.get(page)?.filter(url => /openui|devtools|unpkg|jsdelivr/.test(url))).toEqual([]);
});

async function openHome(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "开始一件事", exact: true })).toBeVisible();
  expect(await page.evaluate(() => typeof (window as any).__TAURI_INTERNALS__)).toBe("undefined");
}

async function navigate(page: Page, label: string) {
  const drawer = page.locator("aside.nav-drawer");
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  if (await menu.isVisible() && !(await drawer.getAttribute("class"))?.includes("is-open")) await menu.click();
  await drawer.getByRole("button", { name: label, exact: true }).click();
}

async function noHorizontalOverflow(page: Page) {
  expect(await page.locator("main").evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
}

// Import the exact Vite module instance; HMR query strings must not create a second mock state.
async function instrumentSends(page: Page) {
  await page.evaluate(async () => {
    const url = performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === "/src/lib/ipc.ts")!.name;
    const { ipc } = await import(/* @vite-ignore */ url);
    const original = ipc.sendAgentInput;
    const state = (window as any).__sends = { calls: [] as { id: string; text: string }[], fail: false };
    ipc.sendAgentInput = async (id: string, text: string) => {
      state.calls.push({ id, text });
      await new Promise(resolve => setTimeout(resolve, 180));
      if (state.fail) throw new Error("测试注入：发送失败");
      return original(id, text);
    };
  });
}

test("桌面侧栏、任务搜索、创建审阅与原有业务出口", async ({ page }) => {
  await openHome(page);
  const drawer = page.locator("aside.nav-drawer");
  await expect(drawer).toBeVisible();
  await expect(page.getByRole("button", { name: "打开导航" })).toHaveCount(0);
  const search = page.getByRole("textbox", { name: "搜索任务" });
  await search.fill("JWT");
  await expect(drawer.locator(".workspace-task")).toHaveCount(1);
  await expect(drawer.locator(".workspace-task")).toContainText("接入 JWT 鉴权");
  await search.fill("不存在的任务标题");
  await expect(drawer).toContainText("没有匹配的任务");
  await search.fill("");

  await page.locator("main textarea").first().fill("修复 Windows 构建失败，并复用已经验证的路径处理经验");
  await page.getByRole("button", { name: "创建任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "这次带上什么" })).toBeVisible();
  await expect(dialog).toContainText("审阅匹配结果");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await navigate(page, "记忆");
  await expect(page.locator("main h1")).toHaveText("记忆");
  await page.getByRole("button", { name: "历史扫描", exact: true }).click();
  await page.getByRole("button", { name: "扫描本机历史", exact: true }).click();
  await expect(page.locator("main")).toContainText("浏览器预览历史会话");
  await page.getByRole("button", { name: "提炼候选", exact: true }).click();
  await expect(page.locator("main")).toContainText("SkillCandidate");
  await expect(page.locator("main")).toContainText("FailureCandidate");
  await page.getByRole("button", { name: "转为待确认", exact: true }).click();
  await page.getByRole("button", { name: "转入失败库", exact: true }).click();
  await page.getByRole("button", { name: /健康与遗忘/ }).click();
  await expect(page.locator("main")).toContainText("已停止召回");

  await navigate(page, "安全");
  await page.getByPlaceholder("输入一条命令,预演海关裁决…").fill("rm -rf /");
  await page.getByRole("button", { name: "试判", exact: true }).click();
  await expect(page.locator("main")).toContainText("destructive_fs");
  await navigate(page, "证据");
  for (const [button, heading] of [["Review Brief", "Review"], ["来源链", "来源链"], ["决策记录", "决策"]]) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.locator("main h1")).toHaveText(heading);
  }
  await navigate(page, "集成");
  await expect(page.locator("main h1")).toHaveText("Agent 集成");
  await expect(page.locator("main")).toContainText("ACP → PTY");
  await navigate(page, "设置");
  await expect(page.locator("main")).toContainText("本地数据");
});

test("390px 抽屉焦点、Escape、窄屏工作台和截图", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  const menu = page.getByRole("button", { name: "打开导航", exact: true });
  await menu.click();
  const drawer = page.getByRole("dialog", { name: "主导航" });
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Shift+Tab");
  expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: ".artifacts/ui-final/mobile-home.png", fullPage: true });
  await navigate(page, "工作台");
  await expect(page.getByRole("textbox", { name: "会话消息" })).toBeDisabled();
  await expect(page.locator(".workspace-title")).toHaveText("修复 Windows 构建失败");
  await noHorizontalOverflow(page);
  await page.screenshot({ path: ".artifacts/ui-final/mobile-workbench.png", fullPage: true });
});

test("工作台动态标题、OpenUI 证据展开、重复挂载和桌面截图", async ({ page }) => {
  await openHome(page);
  await page.screenshot({ path: ".artifacts/ui-final/desktop-home.png", fullPage: true });
  await navigate(page, "工作台");
  const card = page.locator(".evidence-card").first();
  await expect(card).toBeVisible();
  await card.locator("summary").click();
  await expect(card).toHaveAttribute("open", "");
  await expect(card.locator(".evidence-body")).not.toHaveText("");
  await page.getByRole("combobox", { name: "绑定任务", exact: true }).selectOption({ label: "接入 JWT 鉴权" });
  await expect(page.locator(".workspace-title")).toHaveText("接入 JWT 鉴权");
  await page.getByRole("combobox", { name: "Agent", exact: true }).selectOption("codex");
  await expect(page.locator(".workspace-subtitle")).toHaveText("Codex CLI");
  await page.getByRole("combobox", { name: "绑定任务", exact: true }).selectOption({ label: "修复 Windows 构建失败" });
  await expect(page.locator(".evidence-card").first()).toBeVisible();
  await noHorizontalOverflow(page);
  await page.screenshot({ path: ".artifacts/ui-final/desktop-workbench.png", fullPage: true });
  for (let index = 0; index < 6; index += 1) {
    await navigate(page, "记忆");
    await navigate(page, "工作台");
    await expect(page.getByRole("textbox", { name: "会话消息" })).toBeDisabled();
    await page.setViewportSize({ width: index % 2 ? 1440 : 1280, height: 1000 });
  }
});

test("输入法确认不发送、单次发送、失败草稿与停止会话", async ({ page }) => {
  await openHome(page);
  await navigate(page, "工作台");
  const input = page.getByRole("textbox", { name: "会话消息" });
  await expect(input).toBeDisabled();
  await page.getByRole("button", { name: "启动 Agent", exact: true }).click();
  await expect(input).toBeEnabled();
  await instrumentSends(page);
  await input.fill("中文输入");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true });
  await input.dispatchEvent("compositionend");
  expect(await page.evaluate(() => (window as any).__sends.calls.length)).toBe(0);
  await input.press("Shift+Enter");
  expect(await page.evaluate(() => (window as any).__sends.calls.length)).toBe(0);
  await input.press("Enter");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", repeat: true });
  await expect.poll(() => page.evaluate(() => (window as any).__sends.calls.length)).toBe(1);
  await expect(input).toHaveValue("");
  await page.evaluate(() => { (window as any).__sends.fail = true; });
  await input.fill("发送失败后必须保留的草稿");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("发送未完成");
  await expect(input).toHaveValue("发送失败后必须保留的草稿");
  await page.getByRole("button", { name: "停止会话", exact: true }).click();
  await expect(input).toBeDisabled();
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "停止会话", exact: true })).toHaveCount(0);
});

test("过期会话快照不覆盖当前会话，切换任务后不向旧会话发送", async ({ page }) => {
  await openHome(page);
  await navigate(page, "工作台");
  const ids = await page.evaluate(async () => {
    const moduleURL = (path: string) => performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === path)!.name;
    const { ipc } = await import(/* @vite-ignore */ moduleURL("/src/lib/ipc.ts"));
    const { useStore } = await import(/* @vite-ignore */ moduleURL("/src/store.ts"));
    const tasks = useStore.getState().tasks;
    const first = await ipc.startAgentSession({ taskId: tasks[0].id, profileId: "claude_code" });
    const second = await ipc.startAgentSession({ taskId: tasks[1].id, profileId: "codex" });
    await ipc.sendAgentInput(first.id, "OLD_SESSION_ONLY\r\n");
    await ipc.sendAgentInput(second.id, "CURRENT_SESSION_ONLY\r\n");
    const original = ipc.getAgentSnapshot;
    ipc.getAgentSnapshot = async (id: string) => {
      const snapshot = await original(id);
      if (id === first.id) await new Promise(resolve => { (window as any).__releaseOldSnapshot = resolve; });
      return snapshot;
    };
    useStore.getState().setSessions([first, second]);
    return [first.id, second.id];
  });
  await page.getByRole("button", { name: `查看会话 ${ids[0]}`, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "会话消息" })).toBeDisabled();
  await page.getByRole("button", { name: `查看会话 ${ids[1]}`, exact: true }).click();
  await expect(page.getByRole("textbox", { name: "会话消息" })).toBeEnabled();
  await expect(page.locator(".xterm-screen")).toContainText("CURRENT_SESSION_ONLY");
  await page.evaluate(async () => {
    (window as any).__releaseOldSnapshot();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator(".xterm-screen")).not.toContainText("OLD_SESSION_ONLY");
  await expect(page.locator(".workspace-title")).toHaveText("构建管线重构");
  await page.getByRole("combobox", { name: "绑定任务", exact: true }).selectOption({ label: "接入 JWT 鉴权" });
  await expect(page.getByRole("textbox", { name: "会话消息" })).toBeDisabled();
  await expect(page.locator("main")).toContainText("尚未连接会话");
  await expect(page.locator(".workspace-title")).toHaveText("接入 JWT 鉴权");
  await page.getByRole("button", { name: `查看会话 ${ids[0]}`, exact: true }).click();
  await navigate(page, "记忆");
  await page.evaluate(async () => {
    (window as any).__releaseOldSnapshot();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await expect(page.locator("main h1")).toHaveText("记忆");
});

test("发送途中 A→B→A 只清除已发送草稿，不留下可重复提交的命令", async ({ page }) => {
  await openHome(page);
  await navigate(page, "工作台");
  const ids = await page.evaluate(async () => {
    const moduleURL = (path: string) => performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === path)!.name;
    const { ipc } = await import(/* @vite-ignore */ moduleURL("/src/lib/ipc.ts"));
    const { useStore } = await import(/* @vite-ignore */ moduleURL("/src/store.ts"));
    const tasks = useStore.getState().tasks;
    const first = await ipc.startAgentSession({ taskId: tasks[0].id, profileId: "claude_code" });
    const second = await ipc.startAgentSession({ taskId: tasks[1].id, profileId: "codex" });
    const original = ipc.sendAgentInput;
    (window as any).__sendCount = 0;
    ipc.sendAgentInput = async (id: string, text: string) => {
      (window as any).__sendCount += 1;
      await new Promise(resolve => { (window as any).__releaseSend = resolve; });
      return original(id, text);
    };
    useStore.getState().setSessions([first, second]);
    return [first.id, second.id];
  });
  const input = page.getByRole("textbox", { name: "会话消息" });
  await page.getByRole("button", { name: `查看会话 ${ids[0]}`, exact: true }).click();
  await expect(input).toBeEnabled();
  await input.fill("仅执行一次的命令");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(input).toBeDisabled();
  await page.getByRole("button", { name: `查看会话 ${ids[1]}`, exact: true }).click();
  await expect(page.locator(".workspace-title")).toHaveText("构建管线重构");
  await page.getByRole("button", { name: `查看会话 ${ids[0]}`, exact: true }).click();
  await expect(input).toHaveValue("仅执行一次的命令");
  await page.evaluate(() => (window as any).__releaseSend());
  await expect(input).toBeEnabled();
  await expect(input).toHaveValue("");
  await expect(page.getByRole("button", { name: "发送消息", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__sendCount)).toBe(1);
});

test("有界快照明确说明回放范围，切换任务后清除旧提示", async ({ page }) => {
  await openHome(page);
  await navigate(page, "工作台");
  const id = await page.evaluate(async () => {
    const moduleURL = (path: string) => performance.getEntriesByType("resource").find(entry => new URL(entry.name).pathname === path)!.name;
    const { ipc } = await import(/* @vite-ignore */ moduleURL("/src/lib/ipc.ts"));
    const { useStore } = await import(/* @vite-ignore */ moduleURL("/src/store.ts"));
    const session = await ipc.startAgentSession({ taskId: useStore.getState().tasks[0].id, profileId: "claude_code" });
    const original = ipc.getAgentSnapshot;
    ipc.getAgentSnapshot = async (sessionId: string) => {
      if (sessionId !== session.id) return original(sessionId);
      return {
        session: { ...session, lastSeq: 602 }, truncated: true, firstSeq: 600, lastSeq: 602,
        chunks: [600, 601, 602].map(seq => ({ sessionId, seq, direction: "output", text: `tail-${seq}\r\n`, createdAt: "2026-01-01T00:00:00Z" })),
      };
    };
    useStore.getState().setSessions([session]);
    return session.id;
  });
  await page.getByRole("button", { name: `查看会话 ${id}`, exact: true }).click();
  const notice = page.getByTestId("terminal-snapshot-notice");
  await expect(notice).toHaveText("仅回放最近 3 个输出片段（序号 600–602）；完整记录仍保存在本机。");
  await expect(notice).toHaveAttribute("role", "status");
  for (const seq of [600, 601, 602]) await expect(page.locator(".xterm-screen")).toContainText(`tail-${seq}`);
  await page.screenshot({ path: ".artifacts/ui-final/snapshot-tail-notice.png", fullPage: true });
  await page.getByRole("combobox", { name: "绑定任务", exact: true }).selectOption({ label: "接入 JWT 鉴权" });
  await expect(notice).toHaveCount(0);
});

test("后台历史扫描在切出返回后仍互斥并呈现结果", async ({ page }) => {
  // Delay only mock transport; the shared-job coordinator and UI run unchanged.
  await page.route("**/src/lib/ipc.ts*", async route => {
    const response = await route.fetch();
    const source = await response.text();
    const original = 'scanHistory: () => runHistoryJob("scan", "scan_history", {}, () => mock.historyScanSummary())';
    expect(source).toContain(original);
    const replacement = 'scanHistory: () => runHistoryJob("scan", "scan_history", {}, async () => { await new Promise(resolve => { window.__releaseScan = resolve; }); return mock.historyScanSummary(); })';
    await route.fulfill({ response, body: source.replace(original, replacement) });
  });
  await openHome(page);
  await navigate(page, "记忆");
  await page.getByRole("button", { name: "历史扫描", exact: true }).click();
  await page.getByRole("button", { name: "扫描本机历史", exact: true }).click();
  await expect(page.getByRole("button", { name: "后台处理中…", exact: true })).toBeDisabled();
  await navigate(page, "设置");
  await navigate(page, "记忆");
  await page.getByRole("button", { name: "历史扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "后台处理中…", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__releaseScan());
  await expect(page.getByRole("button", { name: "扫描本机历史", exact: true })).toBeEnabled();
  await expect(page.locator("main")).toContainText("浏览器预览历史会话");
});
