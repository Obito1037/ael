import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "开始一件事", exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).__aelModuleURL = (path: string) => {
      const entries = performance.getEntriesByType("resource").filter((entry) => new URL(entry.name).pathname === path);
      if (!entries.length) throw new Error(`Module was not loaded: ${path}`);
      return entries[entries.length - 1].name;
    };
  });
});

// Synthetic IPC fixtures only: never inspect user history or launch an Agent.
test("history ignores stale selection results and requests bounded pages", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(async () => {
    const { ipc } = await import(/* @vite-ignore */ (window as any).__aelModuleURL("/src/lib/ipc.ts"));
    const { useStore } = await import(/* @vite-ignore */ (window as any).__aelModuleURL("/src/store.ts"));
    const conversations = ["Alpha", "Beta"].map((name) => ({
      id: name, title: `Fixture ${name}`, sourceAgent: "codex", sourcePath: "synthetic.jsonl",
      sourceSessionId: name, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
      messageCount: 65, sourceHash: "fixture",
    }));
    ipc.listHistoryConversations = async () => conversations;
    ipc.listHistoryMessages = (id: string, options: { limit: number; offset: number }) => {
      const { limit, offset } = options;
      if (limit !== 30) throw new Error("Preview must request exactly 30 messages");
      return new Promise((resolve) => setTimeout(() => resolve(
        Array.from({ length: Math.min(limit, 65 - offset) }, (_, i) => ({
          id: `${id}-${offset + i}`, conversationId: id, role: "user", kind: "message",
          text: `${id} row ${offset + i + 1}`, createdAt: "2026-01-01T00:00:00Z",
        }))), id === "Alpha" ? 900 : 10));
    };
    useStore.getState().setView("memory");
  });
  await page.getByRole("button", { name: "历史扫描", exact: true }).click();
  await page.getByRole("button", { name: /Fixture Beta/ }).click();
  await expect(page.getByText("Beta row 1", { exact: true })).toBeVisible();
  await page.waitForTimeout(1100);
  await expect(page.getByText("Alpha row 1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Beta row 1", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByText("Beta row 31", { exact: true })).toBeVisible();
  await expect(page.getByText("Beta row 1", { exact: true })).toHaveCount(0);
  await expect(page.getByText("31–60 / 65 条", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await expect(page.getByText("61–65 / 65 条", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "下一页", exact: true })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("history job stays single across page changes and exposes partial results", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.evaluate(async () => {
    const { useStore } = await import(/* @vite-ignore */ (window as any).__aelModuleURL("/src/store.ts"));
    const summary = {
      id: "fixture-scan", startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:01Z",
      filesSeen: 2, conversations: 1, messages: 1, newCandidates: 0,
      sourceCounts: { codex: { sourceAgent: "codex", sessions: 1, messages: 1, skippedFiles: 1, skippedLines: 2, warnings: ["fixture.jsonl: synthetic size limit"] } },
    };
    const state = { scanCalls: 0, release: () => {} };
    (window as any).__fixtureHistory = state;
    // Tauri's invoke bridge is replaced with a fully local controllable fixture.
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "scan_history") {
          state.scanCalls += 1;
          return new Promise((resolve) => { state.release = () => resolve(summary); });
        }
        if (command === "get_history_scan_summary") return summary;
        return [];
      },
    };
    useStore.getState().setView("memory");
  });
  await page.getByRole("button", { name: "历史扫描", exact: true }).click();
  await page.getByRole("button", { name: "扫描本机历史", exact: true }).click();
  await expect(page.getByRole("button", { name: "后台处理中…", exact: true })).toBeDisabled();
  const duplicate = await page.evaluate(async () => {
    const { ipc } = await import(/* @vite-ignore */ (window as any).__aelModuleURL("/src/lib/ipc.ts"));
    try { await ipc.scanHistory(); return "accepted"; } catch (error) { return String(error); }
  });
  expect(duplicate).toContain("仍在后台运行");
  await page.evaluate(async () => {
    const { useStore } = await import(/* @vite-ignore */ (window as any).__aelModuleURL("/src/store.ts"));
    useStore.getState().setView("overview");
  });
  await expect(page.locator("main h1")).toHaveText("开始一件事");
  await page.evaluate(async () => {
    const { useStore } = await import(/* @vite-ignore */ (window as any).__aelModuleURL("/src/store.ts"));
    useStore.getState().setView("memory");
  });
  await page.getByRole("button", { name: "历史扫描", exact: true }).click();
  await expect(page.getByRole("button", { name: "后台处理中…", exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).__fixtureHistory.release());
  await expect(page.getByRole("button", { name: "扫描本机历史", exact: true })).toBeEnabled();
  await expect(page.getByText("部分记录未索引：跳过 1 个文件 / 表、2 行记录", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__fixtureHistory.scanCalls)).toBe(1);
  expect(errors).toEqual([]);
});

test("history errors that finish while away remain visible on return", async ({ page }) => {
  await page.evaluate(async () => {
    const { ipc } = await import(/* @vite-ignore */ (window as any).__aelModuleURL("/src/lib/ipc.ts"));
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string) => {
        if (command === "scan_history") throw { code: "io_error", message: "合成夹具：历史目录读取失败" };
        if (command === "get_history_scan_summary") return null;
        return [];
      },
    };
    await ipc.scanHistory().catch(() => {});
    const { useStore } = await import(/* @vite-ignore */ (window as any).__aelModuleURL("/src/store.ts"));
    useStore.getState().setView("memory");
  });
  await page.getByRole("button", { name: "历史扫描", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("合成夹具：历史目录读取失败");
});
