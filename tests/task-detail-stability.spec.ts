import { expect, test, type Page } from "@playwright/test";

const runtimeErrors = new Map<Page, string[]>();

test.beforeEach(async ({ page }) => {
  runtimeErrors.set(page, []);
  page.on("pageerror", (error) => runtimeErrors.get(page)!.push(error.message));
  await page.route("**/*", (route) => {
    const hostname = new URL(route.request().url()).hostname;
    return ["localhost", "127.0.0.1"].includes(hostname) ? route.continue() : route.abort();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "开始一件事", exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).__taskModuleURL = (path: string) => {
      const entries = performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).pathname === path);
      if (!entries.length) throw new Error(`Module not loaded: ${path}`);
      return entries[entries.length - 1].name;
    };
  });
});

test.afterEach(async ({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

async function openFixture(page: Page, holdAlphaReads = false) {
  await page.evaluate(async (holdAlpha) => {
    const { ipc } = await import(/* @vite-ignore */ (window as any).__taskModuleURL("/src/lib/ipc.ts"));
    const { useStore } = await import(/* @vite-ignore */ (window as any).__taskModuleURL("/src/store.ts"));
    const stamp = "2026-01-01T00:00:00Z";
    const tasks = ["Alpha", "Beta"].map((name) => ({
      id: `task-${name}`, title: `Fixture ${name}`, goal: `Goal ${name}`,
      status: name === "Alpha" ? "in_progress" : "verified", tags: [], createdAt: stamp, updatedAt: stamp,
    }));
    const event = (id: string, summary: string, seq = 1) => ({
      id: `${id}-event-${seq}`, taskId: id, seq, kind: "note", summary, actor: "human", createdAt: stamp,
    });
    const fixture = (window as any).__taskFixture = {
      tasks, holdAlpha, delayedReads: [] as Array<() => void>, finalizeCalls: [] as string[],
      finalizeResolvers: {} as Record<string, () => void>, appendCalls: [] as any[], exportCalls: [] as string[], createCalls: 0,
      events: { "task-Alpha": [event("task-Alpha", "Evidence Alpha")], "task-Beta": [event("task-Beta", "Evidence Beta")] } as Record<string, any[]>,
    };
    ipc.listTasks = async () => fixture.tasks.map((task: any) => ({ ...task }));
    ipc.listEvents = (id: string) => {
      const rows = [...fixture.events[id]];
      return fixture.holdAlpha && id === "task-Alpha"
        ? new Promise((resolve) => fixture.delayedReads.push(() => resolve(rows))) : Promise.resolve(rows);
    };
    ipc.listAgentSessions = (options: { taskId?: string } = {}) => {
      const id = options.taskId;
      if (!id) return Promise.resolve([]);
      const rows = [{ id: `${id}-session`, taskId: id, agentId: "fixture-agent", status: "exited", commandLine: `Session ${id}` }];
      return fixture.holdAlpha && id === "task-Alpha"
        ? new Promise((resolve) => fixture.delayedReads.push(() => resolve(rows))) : Promise.resolve(rows);
    };
    ipc.finalizeTask = (id: string) => {
      fixture.finalizeCalls.push(id);
      return new Promise((resolve) => {
        fixture.finalizeResolvers[id] = () => {
          const task = { ...fixture.tasks.find((item: any) => item.id === id), status: "verified" };
          fixture.tasks = fixture.tasks.map((item: any) => item.id === id ? task : item);
          resolve({ task, draftSkills: [], draftFailures: [], adrs: [], brief: {
            taskId: id, stats: { events: 1 }, decisions: [], errorsFixed: [], verifications: [], interceptions: [], risks: [],
          } });
        };
      });
    };
    ipc.appendEvent = async (args: any) => {
      fixture.appendCalls.push(args);
      const next = event(args.taskId, args.summary, fixture.events[args.taskId].length + 1);
      fixture.events[args.taskId].push(next);
      return next;
    };
    ipc.exportBrief = async (id: string) => { fixture.exportCalls.push(id); return { path: "synthetic/brief.md" }; };
    ipc.createTask = async () => { fixture.createCalls += 1; throw new Error("Creation must go through Overview review"); };
    useStore.getState().setTasks(tasks);
    useStore.getState().setView("tasks");
  }, holdAlphaReads);
  await expect(page.getByRole("heading", { name: "Fixture Alpha", exact: true })).toBeVisible();
}

const selectTask = (page: Page, name: string) => page.locator("main").getByRole("button", { name: new RegExp(`Fixture ${name}`) }).click();
const flushReads = (page: Page) => page.evaluate(async () => {
  (window as any).__taskFixture.delayedReads.forEach((resolve: () => void) => resolve());
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
});

test("switching tasks isolates drafts and ignores late evidence and session reads", async ({ page }) => {
  await openFixture(page, true);
  await page.getByPlaceholder("发生了什么").fill("Alpha unsaved draft");
  await page.getByPlaceholder("补充上下文、原因或证据引用").fill("Alpha draft details");
  await page.locator("main label").filter({ hasText: "类型" }).locator("select").selectOption("error");
  await selectTask(page, "Beta");
  await expect(page.getByRole("heading", { name: "Fixture Beta", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("发生了什么")).toHaveValue("");
  await expect(page.getByPlaceholder("补充上下文、原因或证据引用")).toHaveValue("");
  await expect(page.locator("main label").filter({ hasText: "类型" }).locator("select")).toHaveValue("note");
  await expect(page.getByText("Evidence Beta", { exact: true })).toBeVisible();
  await page.getByPlaceholder("发生了什么").fill("New Beta evidence");
  await page.locator("main").getByRole("button", { name: "保存", exact: true })
    .evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByText("New Beta evidence", { exact: true })).toBeVisible();
  await flushReads(page);
  await expect(page.getByText("Evidence Alpha", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Session task-Alpha", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__taskFixture.appendCalls.map((call: any) => call.taskId))).toEqual(["task-Beta"]);
  await page.locator("main").getByRole("button", { name: "导出 Brief", exact: true }).click();
  expect(await page.evaluate(() => (window as any).__taskFixture.exportCalls)).toEqual(["task-Beta"]);
});

test("the task status control persists through IPC and updates the list", async ({ page }) => {
  await openFixture(page);
  await page.evaluate(async () => {
    const { ipc } = await import(/* @vite-ignore */ (window as any).__taskModuleURL("/src/lib/ipc.ts"));
    ipc.updateTaskStatus = async (id: string, status: string) => {
      (window as any).__statusCalls = [id, status];
      return { ...(window as any).__taskFixture.tasks.find((item: any) => item.id === id), status };
    };
  });
  await page.getByLabel("任务状态", { exact: true }).selectOption("verified");
  await expect(page.getByLabel("任务状态", { exact: true })).toHaveValue("verified");
  expect(await page.evaluate(() => (window as any).__statusCalls)).toEqual(["task-Alpha", "verified"]);
});

test("filters determine the detail pane and new task opens the single review flow", async ({ page }) => {
  await openFixture(page);
  await page.locator("main").getByRole("button", { name: "已验证", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixture Beta", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixture Alpha", exact: true })).toHaveCount(0);
  await page.locator("main").getByRole("button", { name: "失败", exact: true }).click();
  await expect(page.locator("main")).toContainText("当前筛选没有任务");
  await expect(page.locator("main h2")).toHaveCount(0);
  await page.locator("main").getByRole("button", { name: "新建任务", exact: true }).click();
  await expect(page.getByRole("heading", { name: "开始一件事", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__taskFixture.createCalls)).toBe(0);
});

test("late finalization never opens another task's result and stays single across remount", async ({ page }) => {
  await openFixture(page);
  const finalize = page.locator("main").getByRole("button", { name: "收尾任务", exact: true });
  await finalize.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(finalize).toBeDisabled();
  await selectTask(page, "Beta");
  await selectTask(page, "Alpha");
  await expect(finalize).toBeDisabled();
  expect(await page.evaluate(() => (window as any).__taskFixture.finalizeCalls)).toEqual(["task-Alpha"]);
  await selectTask(page, "Beta");
  await page.evaluate(() => (window as any).__taskFixture.finalizeResolvers["task-Alpha"]());
  await expect(page.getByRole("heading", { name: "Fixture Beta", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const alphaStatus = await page.evaluate(async () => {
    const { useStore } = await import(/* @vite-ignore */ (window as any).__taskModuleURL("/src/store.ts"));
    return useStore.getState().tasks.find((task: any) => task.id === "task-Alpha").status;
  });
  expect(alphaStatus).toBe("verified");
  await selectTask(page, "Alpha");
  await expect(finalize).toBeEnabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("returning to a pending task shows its own result exactly once", async ({ page }) => {
  await openFixture(page);
  await page.locator("main").getByRole("button", { name: "收尾任务", exact: true }).click();
  await selectTask(page, "Beta");
  await selectTask(page, "Alpha");
  await page.evaluate(() => (window as any).__taskFixture.finalizeResolvers["task-Alpha"]());
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(page.getByRole("dialog")).toContainText("任务收尾 · 经验沉淀");
  expect(await page.evaluate(() => (window as any).__taskFixture.finalizeCalls)).toEqual(["task-Alpha"]);
});

test("a newer refresh survives an older pending read and page unmount", async ({ page }) => {
  await openFixture(page, true);
  await page.getByPlaceholder("发生了什么").fill("Newest Alpha evidence");
  await page.evaluate(() => { (window as any).__taskFixture.holdAlpha = false; });
  await page.locator("main").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("Newest Alpha evidence", { exact: true })).toBeVisible();
  await flushReads(page);
  await expect(page.getByText("Newest Alpha evidence", { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).__taskFixture.holdAlpha = true;
    (window as any).__taskFixture.delayedReads = [];
  });
  await page.getByPlaceholder("发生了什么").fill("Refresh finishes after leaving");
  await page.locator("main").getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__taskFixture.delayedReads.length)).toBeGreaterThan(0);
  await page.locator("main").getByRole("button", { name: "新建任务", exact: true }).click();
  await flushReads(page);
  await expect(page.getByRole("heading", { name: "开始一件事", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
