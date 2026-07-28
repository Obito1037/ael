import { invoke } from "@tauri-apps/api/core";
import * as mock from "./mock";
import type {
  AdrRecord,
  AgentProfile,
  AgentRecommendation,
  AgentSession,
  AgentSnapshot,
  BlameReport,
  BudgetStatus,
  CommitLink,
  Failure,
  FinalizeResult,
  GuardResult,
  PendingCommand,
  PolicyDecision,
  PolicyVerdict,
  RankedSkill,
  ReviewBrief,
  Settings,
  Skill,
  SkillStatus,
  Task,
  TaskEvent,
  TaskStatus,
  TerminalChunk,
  WorkspaceLock,
} from "../types";

export const isTauri = () =>
  typeof window !== "undefined" &&
  (window as any).__TAURI_INTERNALS__ !== undefined;

/** 在 Tauri 里走真实 invoke;浏览器预览走内存 mock。 */
async function call<T>(cmd: string, args: Record<string, unknown>, fallback: () => T | Promise<T>): Promise<T> {
  if (isTauri()) return invoke<T>(cmd, args);
  return fallback();
}

export const ipc = {
  // ── 任务 ─────────────────────────────────────────────
  createTask: (a: {
    title: string;
    goal: string;
    agentId?: string;
    repoPath?: string;
    repoBranch?: string;
    repoCommit?: string;
    tags?: string[];
  }) => call<Task>("create_task", a, () => mock.createTask(a)),

  getTask: (id: string) => call<Task>("get_task", { id }, () => mock.getTask(id)),

  listTasks: (a: { status?: TaskStatus; limit?: number; offset?: number } = {}) =>
    call<Task[]>("list_tasks", a, () => mock.listTasks(a)),

  updateTaskStatus: (id: string, status: TaskStatus) =>
    call<Task>("update_task_status", { id, status }, () => mock.updateTaskStatus(id, status)),

  finalizeTask: (id: string) =>
    call<FinalizeResult>("finalize_task", { id }, () => mock.finalizeTask(id)),

  // ── 证据链 ───────────────────────────────────────────
  appendEvent: (a: {
    taskId: string;
    kind: TaskEvent["kind"];
    summary: string;
    detail?: string;
    evidenceRef?: string;
    actor?: TaskEvent["actor"];
    sessionId?: string;
    anchorFile?: string;
    anchorLines?: string;
  }) => call<TaskEvent>("append_event", a, () => mock.appendEvent(a)),

  listEvents: (taskId: string) =>
    call<TaskEvent[]>("list_events", { taskId }, () => mock.listEvents(taskId)),

  // ── Skill / Failure ──────────────────────────────────
  listSkills: (a: { status?: SkillStatus; limit?: number; offset?: number } = {}) =>
    call<Skill[]>("list_skills", a, () => mock.listSkills(a)),

  updateSkillStatus: (id: string, status: SkillStatus) =>
    call<Skill>("update_skill_status", { id, status }, () => mock.updateSkillStatus(id, status)),

  searchSkills: (a: { query: string; status?: SkillStatus; limit?: number }) =>
    call<RankedSkill[]>("search_skills", a, () => mock.searchSkills(a)),

  listFailures: (a: { limit?: number; offset?: number } = {}) =>
    call<Failure[]>("list_failures", a, () => mock.listFailures()),

  checkFailureGuard: (goal: string, tags?: string[]) =>
    call<GuardResult>("check_failure_guard", { goal, tags }, () => mock.checkFailureGuard(goal, tags)),

  // ── 出口③ 海关 ───────────────────────────────────────
  gateListPending: () => call<PendingCommand[]>("gate_list_pending", {}, () => mock.gateListPending()),
  gateResolvePending: (pendingId: string, approve: boolean) =>
    call<PolicyDecision>("gate_resolve_pending", { pendingId, approve }, () =>
      mock.gateResolvePending(pendingId, approve),
    ),
  gateListDecisions: (a: { taskId?: string; sessionId?: string; limit?: number; offset?: number } = {}) =>
    call<PolicyDecision[]>("gate_list_decisions", a, () => mock.gateListDecisions(a)),
  gateGetPolicyText: () => call<string>("gate_get_policy_text", {}, () => mock.gateGetPolicyText()),
  gateSetPolicyText: (text: string) =>
    call<void>("gate_set_policy_text", { text }, () => mock.gateSetPolicyText(text)),
  gateTestCommand: (commandText: string) =>
    call<PolicyVerdict>("gate_test_command", { commandText }, () => mock.gateTestCommand(commandText)),
  gateGetBudget: (sessionId: string) =>
    call<BudgetStatus>("gate_get_budget", { sessionId }, () => mock.gateGetBudget()),

  // ── 出口① Review Brief ───────────────────────────────
  compileBrief: (taskId: string) =>
    call<ReviewBrief>("compile_brief", { taskId }, () => mock.compileBrief(taskId)),
  exportBrief: (taskId: string) =>
    call<{ path: string }>("export_brief", { taskId }, () => ({ path: `~/.ael/briefs/${taskId}.md` })),

  // ── 出口④ 活文档 ADR ─────────────────────────────────
  listAdrs: (taskId?: string) => call<AdrRecord[]>("list_adrs", { taskId }, () => mock.listAdrs(taskId)),
  compileAdrs: (taskId: string) =>
    call<AdrRecord[]>("compile_adrs", { taskId }, () => mock.listAdrs(taskId)),
  exportAdrs: (taskId: string, repoPath?: string) =>
    call<string[]>("export_adrs", { taskId, repoPath }, () => mock.listAdrs(taskId).map((a) => `adr/${a.number}.md`)),

  // ── 出口② Agent Blame ────────────────────────────────
  generateCommitTrailer: (taskId: string) =>
    call<{ trailer: string }>("generate_commit_trailer", { taskId }, () => ({
      trailer: `AEL-Task: ${taskId}`,
    })),
  listCommitLinks: (taskId: string) =>
    call<CommitLink[]>("list_commit_links", { taskId }, () => mock.listCommitLinks(taskId)),
  scanRepoCommits: (repoPath: string) =>
    call<CommitLink[]>("scan_repo_commits", { repoPath }, () => mock.scanRepoCommits()),
  blameLine: (repoPath: string, file: string, line: number) =>
    call<BlameReport>("blame_line", { repoPath, file, line }, () => mock.blameLine(file, line)),

  // ── 横向:路由 + 保鲜期 ──────────────────────────────
  recommendAgents: (goal: string, tags?: string[]) =>
    call<AgentRecommendation[]>("recommend_agents", { goal, tags }, () => mock.recommendAgents()),
  runFreshnessCheck: (currentModel?: string) =>
    call<{ downgraded: number }>("run_freshness_check", { currentModel }, () => ({ downgraded: 0 })),
  revalidateSkill: (skillId: string, currentModel?: string) =>
    call<Skill>("revalidate_skill", { skillId, currentModel }, () => mock.revalidateSkill(skillId)),

  // ── Agent Runtime ────────────────────────────────────
  detectAgents: () => call<AgentProfile[]>("detect_agents", {}, () => mock.detectAgents()),
  startAgentSession: (a: {
    taskId: string;
    profileId: string;
    cwd?: string;
    initialPrompt?: string;
    rows?: number;
    cols?: number;
    autoIngest?: boolean;
    lockWorkspace?: boolean;
  }) => call<AgentSession>("start_agent_session", a, () => mock.startAgentSession(a)),
  sendAgentInput: (sessionId: string, text: string) =>
    call<void>("send_agent_input", { sessionId, text }, () => mock.sendAgentInput(sessionId, text)),
  resizeAgentTerminal: (sessionId: string, cols: number, rows: number) =>
    call<void>("resize_agent_terminal", { sessionId, cols, rows }, () => undefined),
  stopAgentSession: (sessionId: string, killTree = true) =>
    call<AgentSession>("stop_agent_session", { sessionId, killTree }, () => mock.stopAgentSession(sessionId)),
  listAgentSessions: (a: { taskId?: string; status?: string } = {}) =>
    call<AgentSession[]>("list_agent_sessions", a, () => mock.listAgentSessions(a)),
  getAgentSnapshot: (sessionId: string) =>
    call<AgentSnapshot>("get_agent_snapshot", { sessionId }, () => mock.getAgentSnapshot(sessionId)),
  listTerminalChunks: (sessionId: string, afterSeq?: number) =>
    call<TerminalChunk[]>("list_terminal_chunks", { sessionId, afterSeq }, () => []),
  listWorkspaceLocks: () => call<WorkspaceLock[]>("list_workspace_locks", {}, () => mock.listWorkspaceLocks()),
  buildAgentStartupContext: (a: {
    taskId: string;
    agentKind?: string;
    profileId?: string;
    manualNote?: string;
  }) => call<any>("build_agent_startup_context", a, () => mock.buildStartupContext(a)),

  // ── 设置 ─────────────────────────────────────────────
  getSettings: () => call<Settings>("get_settings", {}, () => mock.SETTINGS),
  setSettings: (a: Partial<Settings>) =>
    call<Settings>("set_settings", a, () => mock.setSettings(a)),
  backupNow: () => call<{ path: string }>("backup_now", {}, () => ({ path: "~/.ael/backups/ael-now.db" })),
};

export type Ipc = typeof ipc;
