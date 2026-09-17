import { invoke } from "@tauri-apps/api/core";
import * as mock from "./mock";
import type {
  AdrRecord,
  AgentConfigContent,
  AgentConfigTarget,
  AgentConfigWriteResult,
  AgentProfile,
  AgentRecommendation,
  AgentSession,
  AgentSnapshot,
  BlameReport,
  BudgetStatus,
  CandidateExtractionSummary,
  CandidateStatus,
  CompressResult,
  CommitLink,
  Failure,
  FailureCandidate,
  FinalizeResult,
  GuardResult,
  HistoryConversation,
  HistoryMessage,
  HistoryScanSummary,
  SkillCandidate,
  PendingCommand,
  McpServerConfig,
  PolicyDecision,
  PolicyVerdict,
  RankedSkill,
  ProviderConfig,
  ReviewBrief,
  Settings,
  SessionTokenUsage,
  Skill,
  SkillExportResult,
  SkillStatus,
  Task,
  TaskEvent,
  TaskStatus,
  TerminalChunk,
  TestProviderResult,
  WorkspaceLock,
} from "../types";

export const isTauri = () =>
  typeof window !== "undefined" &&
  (window as any).__TAURI_INTERNALS__ !== undefined;

/** 在 Tauri 里走真实 invoke;浏览器预览走内存 mock。 */
const IPC_TIMEOUT_MS = 30_000;

async function invokeWithTimeout<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<T>(cmd, args),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`IPC 调用超时: ${cmd}`)), IPC_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function call<T>(cmd: string, args: Record<string, unknown>, fallback: () => T | Promise<T>): Promise<T> {
  if (isTauri()) return invokeWithTimeout<T>(cmd, args);
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

  getSkill: (id: string) =>
    call<Skill>("get_skill", { id }, () => {
      const skill = mock.listSkills({}).find((item) => item.id === id);
      if (!skill) throw new Error(`Skill ${id} 不存在`);
      return skill;
    }),

  createSkill: (a: { name: string; trigger: string; body: string; tags?: string[]; sourceTaskId?: string }) =>
    call<Skill>("create_skill", a, () => {
      throw new Error("浏览器预览不支持手工创建 Skill，请在桌面应用中操作。");
    }),

  updateSkill: (a: { id: string; name?: string; trigger?: string; body?: string; tags?: string[] }) =>
    call<Skill>("update_skill", a, () => {
      throw new Error("浏览器预览不支持编辑 Skill，请在桌面应用中操作。");
    }),

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
    runtime?: "auto" | "acp" | "pty";
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
    call<TerminalChunk[]>("list_terminal_chunks", { sessionId, afterSeq }, () => mock.getAgentSnapshot(sessionId).chunks),
  listWorkspaceLocks: () => call<WorkspaceLock[]>("list_workspace_locks", {}, () => mock.listWorkspaceLocks()),
  releaseWorkspaceLocksForSession: (sessionId: string) =>
    call<number>("release_workspace_locks_for_session", { sessionId }, () => 0),
  getSessionTokenUsage: (sessionId: string) =>
    call<SessionTokenUsage>("get_session_token_usage", { sessionId }, () => ({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      source: "transcript_estimate",
    })),
  compressContext: (a: { sessionId?: string; text?: string; mode: "summary" | "budget" | "handover"; tokenBudget?: number }) =>
    call<CompressResult>("compress_context", a, () => ({
      compressed: a.text || "",
      tokensBefore: Math.ceil((a.text || "").length / 4),
      tokensAfter: Math.ceil((a.text || "").length / 4),
    })),
  buildAgentStartupContext: (a: {
    taskId: string;
    agentKind?: string;
    profileId?: string;
    manualNote?: string;
    eventLimit?: number;
    skillLimit?: number;
    includeGuard?: boolean;
    includeSkills?: boolean;
    includeHandover?: boolean;
    tokenBudget?: number;
  }) => call<any>("build_agent_startup_context", a, () => mock.buildStartupContext(a)),

  // ── 本机历史索引 ─────────────────────────────────────
  scanHistory: () => call<HistoryScanSummary>("scan_history", {}, () => mock.historyScanSummary()),
  getHistoryScanSummary: () =>
    call<HistoryScanSummary | null>("get_history_scan_summary", {}, () => mock.historyScanSummary()),
  listHistoryConversations: (a: { limit?: number; offset?: number } = {}) =>
    call<HistoryConversation[]>("list_history_conversations", a, () => mock.historyConversations()),
  getHistoryConversation: (id: string) =>
    call<HistoryConversation>("get_history_conversation", { id }, () => mock.historyConversations()[0]),
  listHistoryMessages: (conversationId: string) =>
    call<HistoryMessage[]>("list_history_messages", { conversationId }, () => mock.historyMessages(conversationId)),

  // ── 候选经验审阅 ─────────────────────────────────────
  extractHistoryCandidates: () =>
    call<CandidateExtractionSummary>("extract_history_candidates", {}, () => mock.extractHistoryCandidates()),
  distillHistoryCandidates: (a: { profileId?: "codex" | "claude_code"; cwd?: string; conversationId?: string } = {}) =>
    call<CandidateExtractionSummary>("distill_history_candidates", a, () => mock.distillHistoryCandidates()),
  listSkillCandidates: (status?: CandidateStatus) =>
    call<SkillCandidate[]>("list_skill_candidates", { status, limit: 200 }, () => mock.skillCandidates()),
  listFailureCandidates: (status?: CandidateStatus) =>
    call<FailureCandidate[]>("list_failure_candidates", { status, limit: 200 }, () => mock.failureCandidates()),
  updateSkillCandidateStatus: (id: string, status: CandidateStatus) =>
    call<SkillCandidate>("update_skill_candidate_status", { id, status }, () => mock.updateSkillCandidateStatus(id, status)),
  updateFailureCandidateStatus: (id: string, status: CandidateStatus) =>
    call<FailureCandidate>("update_failure_candidate_status", { id, status }, () => mock.updateFailureCandidateStatus(id, status)),
  promoteSkillCandidate: (id: string) =>
    call<Skill>("promote_skill_candidate", { id }, () => mock.promoteSkillCandidate(id)),
  promoteFailureCandidate: (id: string) =>
    call<Failure>("promote_failure_candidate", { id }, () => mock.promoteFailureCandidate(id)),

  // ── Agent 配置中心（兼容层）────────────────────────
  listProviders: () => call<ProviderConfig[]>("list_providers", {}, () => mock.listProviders()),
  saveProvider: (provider: ProviderConfig) =>
    call<void>("save_provider", { provider }, () => mock.saveProvider(provider)),
  testProvider: (providerId: string) =>
    call<TestProviderResult>("test_provider", { providerId }, () => mock.testProvider(providerId)),
  listMcpServers: () => call<McpServerConfig[]>("list_mcp_servers", {}, () => mock.listMcpServers()),
  saveMcpServer: (server: McpServerConfig) =>
    call<void>("save_mcp_server", { server }, () => mock.saveMcpServer(server)),
  recordSkillUsage: (skillId: string, taskId: string, outcome: "helped" | "neutral" | "harmful") =>
    call<void>("record_skill_usage", { skillId, taskId, outcome }, () => undefined),
  exportSkill: (id: string, agents?: string[]) =>
    call<SkillExportResult>("export_skill", { id, agents }, () => ({ path: `~/.ael/skills/${id}/SKILL.md`, publishedByCli: false, message: "浏览器预览仅生成标准 SKILL.md。" })),
  listAgentConfigTargets: (cwd?: string) =>
    call<AgentConfigTarget[]>("list_agent_config_targets", { cwd }, () => mock.listAgentConfigTargets(cwd)),
  readAgentConfigTarget: (targetId: string, cwd?: string) =>
    call<AgentConfigContent>("read_agent_config_target", { targetId, cwd }, () => mock.readAgentConfigTarget(targetId)),
  writeAgentConfigTarget: (targetId: string, content: string, cwd?: string, createBackup = true) =>
    call<AgentConfigWriteResult>("write_agent_config_target", { targetId, content, cwd, createBackup }, () =>
      mock.writeAgentConfigTarget(targetId, content),
    ),
  backupAgentConfigTarget: (targetId: string, cwd?: string) =>
    call<string | null>("backup_agent_config_target", { targetId, cwd }, () => mock.backupAgentConfigTarget(targetId)),

  // ── 设置 ─────────────────────────────────────────────
  getSettings: () => call<Settings>("get_settings", {}, () => mock.SETTINGS),
  setSettings: (a: Partial<Settings>) =>
    call<Settings>("set_settings", a, () => mock.setSettings(a)),
  backupNow: () => call<{ path: string }>("backup_now", {}, () => ({ path: "~/.ael/backups/ael-now.db" })),
  exportHandover: (taskId: string, include?: { events?: boolean; skills?: boolean; failures?: boolean; openQuestions?: string[] }) =>
    call<{ path: string }>("export_handover", { taskId, include }, () => ({ path: `~/.ael/handovers/${taskId}.zip` })),
  importHandover: (path: string) =>
    call<{ taskId: string }>("import_handover", { path }, () => {
      throw new Error("浏览器预览不支持导入交接包，请在桌面应用中操作。");
    }),
  generateHandoverPrompt: (taskId: string) =>
    call<{ prompt: string }>("generate_handover_prompt", { taskId }, () => ({ prompt: "" })),
};

export type Ipc = typeof ipc;
