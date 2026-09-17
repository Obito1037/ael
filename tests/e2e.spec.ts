import { expect, test } from "@playwright/test";

async function navigate(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("button", { name: "打开导航" }).click();
  const drawer = page.locator("aside.nav-drawer");
  await expect(drawer).toBeVisible();
  await drawer.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();
}

// 浏览器预览使用内置 mock，覆盖新信息架构的关键前端闭环。
test("暖纸工作台、记忆治理与原有业务出口可用", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "AEL" })).toBeVisible();
  await expect(page.locator("main h1")).toHaveText("开始一件事");

  // 新任务先审阅将被复用的记忆，不静默创建。
  await page.locator("main textarea").first().fill("修复 Windows 构建失败，并复用已经验证的路径处理经验");
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page.getByRole("heading", { name: "这次带上什么" })).toBeVisible();
  await expect(page.getByText(/本次带上/).first()).toBeVisible();
  await page.getByRole("button", { name: "关闭" }).click();

  // 记忆页提供待确认、健康和可逆遗忘入口。
  await navigate(page, "记忆");
  await expect(page.locator("main h1")).toHaveText("记忆");
  await expect(page.getByRole("button", { name: /待确认/ })).toBeVisible();
  await page.getByRole("button", { name: "历史扫描" }).click();
  await expect(page.locator("main")).toContainText("本机历史扫描");
  await page.getByRole("button", { name: "扫描本机历史" }).click();
  await expect(page.locator("main")).toContainText("浏览器预览历史会话");
  await page.getByRole("button", { name: "提炼候选" }).click();
  await expect(page.locator("main")).toContainText("SkillCandidate");
  await expect(page.locator("main")).toContainText("FailureCandidate");
  await page.getByRole("button", { name: "转为待确认" }).click();
  await page.getByRole("button", { name: "转入失败库" }).click();
  await expect(page.locator("main")).toContainText("候选包含来源消息和质量分");
  await page.getByRole("button", { name: /健康与遗忘/ }).click();
  await expect(page.locator("main")).toContainText("需要处理");
  await expect(page.locator("main")).toContainText("已停止召回");

  // 安全：命令试判仍走原有策略引擎。
  await navigate(page, "安全");
  await expect(page.locator("main h1")).toHaveText("安全");
  const probe = page.getByPlaceholder("输入一条命令,预演海关裁决…");
  await probe.fill("rm -rf /");
  await page.getByRole("button", { name: "试判" }).click();
  await expect(page.locator("main")).toContainText("扣留");
  await expect(page.locator("main")).toContainText("destructive_fs");

  // 任务、Review、来源链和决策统一收束到证据入口。
  await navigate(page, "证据");
  await expect(page.getByRole("button", { name: "Review Brief" })).toBeVisible();
  await page.getByRole("button", { name: "Review Brief" }).click();
  await expect(page.locator("main h1")).toHaveText("Review");
  await page.getByRole("button", { name: "来源链" }).click();
  await expect(page.locator("main h1")).toHaveText("来源链");
  await page.getByRole("button", { name: "决策记录" }).click();
  await expect(page.locator("main h1")).toHaveText("决策");

  await navigate(page, "工作台");
  await expect(page.locator("header")).toContainText("修复 Windows 构建失败");
  await expect(page.locator("main")).toContainText("启动 Agent");

  // 集成页只展示 Agent/ACP/外部工具状态，不把 Provider/MCP 深度配置做成主流程。
  await navigate(page, "集成");
  await expect(page.locator("main h1")).toHaveText("Agent 集成");
  await expect(page.locator("main")).toContainText("ACP → PTY");
  await expect(page.locator("main")).toContainText("外部入口状态");

  await navigate(page, "设置");
  await expect(page.locator("main h1")).toHaveText("设置");
  await expect(page.locator("main")).toContainText("本地数据");
});
