import type { AdrRecord, Failure, ReviewBrief, Skill, Task, TaskEvent } from "../types";

/** Download a generated browser artifact; never treat a filename as a local path. */
export function downloadText(filename: string, text: string, mime = "text/plain;charset=utf-8"): string {
  if (typeof document === "undefined" || !document.body || typeof URL.createObjectURL !== "function") {
    throw new Error("当前环境不支持浏览器下载。");
  }
  let safeName = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^[.\s]+|[.\s]+$/g, "").slice(0, 160) || "ael-export.txt";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(safeName)) safeName = `ael-${safeName}`;
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const anchor = document.createElement("a");
  try {
    anchor.href = url;
    anchor.download = safeName;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
  } finally {
    anchor.remove();
    // Revoking synchronously can cancel downloads in WebKit and embedded hosts.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  return safeName;
}

export const demoDownloadMessage = (filename: string) => `已发起浏览器下载：${filename}（演示数据）`;

const demoHeader = "---\nsimulation: true\nsource: browser-demo\n---\n\n> AEL 浏览器演示数据。用于体验工作流，不代表真实 Agent 执行或测试结果。\n\n";

export function formatDemoBrief(brief: ReviewBrief): string {
  const sections = [
    `# Review Brief · ${brief.title}`,
    `任务：${brief.taskId}\n状态：${brief.status}\n生成时间：${brief.generatedAt}`,
    `## 目标\n${brief.goal}`,
    `## 决策\n${brief.decisions.map(item => `- ${item.summary}${item.reason ? `\n  原因：${item.reason}` : ""}`).join("\n") || "暂无记录。"}`,
    `## 错误与修复\n${brief.errorsFixed.map(item => `- ${item.error}\n  修复：${item.fix}`).join("\n") || "暂无记录。"}`,
    `## 验证记录\n${brief.verifications.map(item => `- ${item.summary}${item.evidenceRef ? `\n  引用：${item.evidenceRef}` : ""}`).join("\n") || "未记录验证。"}`,
    `## 风险\n${brief.risks.map(item => `- ${item}`).join("\n") || "暂无记录。"}`,
  ];
  return demoHeader + sections.join("\n\n") + "\n";
}

export function formatDemoAdrs(adrs: AdrRecord[]): string {
  return demoHeader + adrs.map(adr => [
    `# ADR-${String(adr.number).padStart(4, "0")} · ${adr.title}`,
    `任务：${adr.taskId || "未关联"}\n状态：${adr.status}\n来源事件：${adr.sourceEventId || "未关联"}`,
    `## 背景\n${adr.context}`,
    `## 决定\n${adr.decision}`,
    `## 影响\n${adr.consequences || "暂无记录。"}`,
  ].join("\n\n")).join("\n\n---\n\n") + "\n";
}

export function formatDemoHandover(data: {
  task: Task;
  events?: TaskEvent[];
  skills?: Skill[];
  failures?: Failure[];
  openQuestions?: string[];
}): string {
  return JSON.stringify({
    schema: "ael.browser-demo.handover.v1",
    simulation: true,
    source: "browser-demo",
    generatedAt: new Date().toISOString(),
    notice: "此文件是可阅读的 JSON 演示资料，不是桌面版 handover.zip，也不是实际执行凭据。",
    ...data,
  }, null, 2) + "\n";
}
