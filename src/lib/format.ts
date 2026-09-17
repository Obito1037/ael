import type {
  AdrStatus,
  AgentSessionStatus,
  EventActor,
  EventKind,
  PolicyAction,
  PolicyVerdictKind,
  SkillStatus,
  TaskStatus,
} from "../types";

export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter(Boolean).join(" ");

/** 相对时间(中文) */
export function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return iso;
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return "刚刚";
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  if (s < 2592000) return `${Math.floor(s / 86400)} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

export function shortDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function humanTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return `${n}`;
}

export function humanDuration(secs?: number): string {
  if (secs == null) return "—";
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m${secs % 60}s`;
  return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
}

// ── 文案映射 ───────────────────────────────────────────────────

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待开始",
  in_progress: "进行中",
  blocked: "阻塞",
  verified: "已验证",
  failed: "失败",
  abandoned: "已放弃",
};

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  step: "步骤",
  error: "错误",
  fix: "修复",
  verification: "验证",
  decision: "决策",
  note: "备注",
};

export const ACTOR_LABEL: Record<EventActor, string> = {
  ai: "AI 提议",
  human: "人工",
  guard: "Guard",
  system: "系统",
};

export const SKILL_STATUS_LABEL: Record<SkillStatus, string> = {
  draft: "草案",
  active: "已启用",
  deprecated: "已弃用",
};

export const ADR_STATUS_LABEL: Record<AdrStatus, string> = {
  proposed: "提议中",
  accepted: "已采纳",
  superseded: "已取代",
};

export const SESSION_STATUS_LABEL: Record<AgentSessionStatus, string> = {
  starting: "启动中",
  running: "运行中",
  waiting: "等待输入",
  blocked: "阻塞",
  exited: "已退出",
  killed: "已停止",
  failed: "失败",
};

export const ACTION_LABEL: Record<PolicyAction, string> = {
  allow: "放行",
  warn: "警告",
  hold: "扣留",
  deny: "拦截",
};

export const VERDICT_LABEL: Record<PolicyVerdictKind, string> = {
  passed: "已放行",
  warned: "已警告",
  approved: "人工放行",
  denied: "人工拦截",
  auto_denied: "默认拦截",
};

// ── 语义色(tailwind class 片段) ─────────────────────────────

export const eventKindColor: Record<EventKind, string> = {
  step: "text-ink/70",
  error: "text-red",
  fix: "text-green",
  verification: "text-green",
  decision: "text-orange",
  note: "text-blue",
};

export const actorTone: Record<EventActor, "orange" | "blue" | "green" | "ink"> = {
  ai: "orange",
  human: "blue",
  guard: "green",
  system: "ink",
};

export const taskStatusTone: Record<TaskStatus, "green" | "blue" | "amber" | "red" | "ink"> = {
  pending: "ink",
  in_progress: "blue",
  blocked: "amber",
  verified: "green",
  failed: "red",
  abandoned: "ink",
};

export const verdictTone: Record<PolicyVerdictKind, "green" | "red" | "amber"> = {
  passed: "green",
  warned: "amber",
  approved: "green",
  denied: "red",
  auto_denied: "red",
};
