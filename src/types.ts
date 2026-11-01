// 领域类型 · 与 src-tauri/src/models.rs(serde camelCase)逐字段对齐。
// 枚举用后端的 snake_case 字符串字面量。

export type TaskStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "verified"
  | "failed"
  | "abandoned";

export type EventKind =
  | "step"
  | "error"
  | "fix"
  | "verification"
  | "decision"
  | "note";

export type EventActor = "ai" | "human" | "guard" | "system";
export type SkillStatus = "draft" | "active" | "deprecated";
export type Freshness = "fresh" | "needs_revalidation";
export type Outcome = "helped" | "neutral" | "harmful";
export type PolicyAction = "allow" | "warn" | "hold" | "deny";
export type PolicyVerdictKind =
  | "passed"
  | "warned"
  | "approved"
  | "denied"
  | "auto_denied";
export type DecidedBy = "policy" | "human";
export type AdrStatus = "proposed" | "accepted" | "superseded";
export type RetrievalMode = "keyword" | "hybrid";

export interface Task {
  id: string;
  title: string;
  goal: string;
  status: TaskStatus;
  agentId?: string;
  repoPath?: string;
  repoBranch?: string;
  repoCommit?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  seq: number;
  kind: EventKind;
  summary: string;
  detail?: string;
  evidenceRef?: string;
  actor: EventActor;
  sessionId?: string;
  anchorFile?: string;
  anchorLines?: string;
  createdAt: string;
}

export interface Skill {
  id: string;
  name: string;
  trigger: string;
  body: string;
  tags: string[];
  sourceTaskId?: string;
  status: SkillStatus;
  version: number;
  successCount: number;
  failCount: number;
  originAgent?: string;
  originModel?: string;
  freshness: Freshness;
  revalidatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SkillExportResult {
  path: string;
  publishedByCli: boolean;
  message: string;
}

export interface Failure {
  id: string;
  signature: string;
  description: string;
  rootCause?: string;
  fix?: string;
  guardRule: string;
  tags: string[];
  occurrences: number;
  originAgent?: string;
  originModel?: string;
}

export interface HistoryConversation {
  id: string;
  sourceAgent: string;
  sourcePath: string;
  sourceSessionId: string;
  title: string;
  repoPath?: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  sourceHash: string;
}

export interface HistoryMessage {
  id: string;
  conversationId: string;
  sourceMessageId?: string;
  role: string;
  kind: string;
  text: string;
  createdAt: string;
  spanStart?: number;
  spanEnd?: number;
  toolName?: string;
  payloadJson?: string;
}

export interface HistorySourceCount {
  sourceAgent: string;
  sessions: number;
  messages: number;
  skippedFiles?: number;
  skippedLines?: number;
  warnings?: string[];
}

export interface HistoryScanSummary {
  id: string;
  startedAt: string;
  endedAt: string;
  filesSeen: number;
  conversations: number;
  messages: number;
  sourceCounts: Record<string, HistorySourceCount>;
  newCandidates: number;
}

export type CandidateStatus = "candidate" | "accepted" | "rejected" | "merged" | "exported";

export interface SkillCandidate {
  id: string;
  name: string;
  triggerText: string;
  scope: string;
  problem: string;
  steps: string[];
  antiPatterns: string[];
  verification: string[];
  tags: string[];
  sourceSessions: string[];
  sourceMessages: string[];
  sourceErrors: string[];
  sourceCommits: string[];
  confidence: number;
  status: CandidateStatus;
  createdByAgent?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FailureCandidate {
  id: string;
  signature: string;
  normalizedText: string;
  description: string;
  rootCause?: string;
  fix?: string;
  guardRule: string;
  verification: string[];
  tags: string[];
  sourceSessions: string[];
  sourceMessages: string[];
  sourceErrors: string[];
  sourceCommits: string[];
  confidence: number;
  status: CandidateStatus;
  createdByAgent?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CandidateExtractionSummary {
  skillCandidates: number;
  failureCandidates: number;
  skippedLowEvidence: number;
}

export interface RankedSkill {
  skill: Skill;
  score: number;
}

export interface GuardResult {
  matchedFailures: Failure[];
  suggestedSkills: Skill[];
  constraints: string[];
  handoverPrompt: string;
}

// ── 治理层 ─────────────────────────────────────────────────────

export interface PolicyDecision {
  id: string;
  sessionId?: string;
  taskId?: string;
  ruleId: string;
  action: PolicyAction;
  verdict: PolicyVerdictKind;
  commandText: string;
  reason: string;
  decidedBy: DecidedBy;
  createdAt: string;
  resolvedAt?: string;
}

export interface PendingCommand {
  id: string;
  sessionId: string;
  taskId: string;
  commandText: string;
  ruleId: string;
  reason: string;
  createdAt: string;
  timeoutSecs: number;
  permissionOptions?: PermissionOption[];
}

export interface PermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

export interface PolicyVerdict {
  ruleId?: string;
  action: PolicyAction;
  reason: string;
  matched: boolean;
}

export interface BudgetStatus {
  enabled: boolean;
  maxSessionTokens: number;
  usedTokens: number;
  ratio: number;
  breakerTripped: boolean;
}

export interface SessionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source: "agent_reported" | "transcript_estimate" | string;
}

export interface CompressResult {
  compressed: string;
  tokensBefore: number;
  tokensAfter: number;
}

export interface AdrRecord {
  id: string;
  taskId?: string;
  number: number;
  title: string;
  status: AdrStatus;
  context: string;
  decision: string;
  consequences?: string;
  sourceEventId?: string;
  filePath?: string;
  createdAt: string;
}

export interface CommitLink {
  id: string;
  taskId: string;
  sessionId?: string;
  repoPath: string;
  commitHash: string;
  subject?: string;
  author?: string;
  committedAt?: string;
  createdAt: string;
}

export interface AgentSessionSummary {
  id: string;
  agentId: string;
  commandLine: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
}

export interface BlameReport {
  file: string;
  line: number;
  commitHash?: string;
  commitSubject?: string;
  commitAuthor?: string;
  linked: boolean;
  task?: Task;
  sessions: AgentSessionSummary[];
  decisions: TaskEvent[];
  humanConfirmations: TaskEvent[];
  guardEvents: TaskEvent[];
  adrs: AdrRecord[];
}

// Review Brief
export interface BriefDecision {
  summary: string;
  reason?: string;
  actor: EventActor;
}
export interface BriefErrorFixed {
  error: string;
  fix?: string;
  signature?: string;
  recurrences: number;
}
export interface BriefVerification {
  summary: string;
  evidenceRef?: string;
}
export interface BriefStats {
  events: number;
  sessions: number;
  tokensEst: number;
  humanConfirmed: number;
  aiProposed: number;
  durationSecs?: number;
}
export interface ReviewBrief {
  taskId: string;
  title: string;
  goal: string;
  status: TaskStatus;
  generatedAt: string;
  decisions: BriefDecision[];
  errorsFixed: BriefErrorFixed[];
  verifications: BriefVerification[];
  interceptions: PolicyDecision[];
  risks: string[];
  stats: BriefStats;
  markdown: string;
}

export interface AgentRecommendation {
  agentKind: string;
  score: number;
  successCount: number;
  failCount: number;
  taskCount: number;
  reasons: string[];
}

export interface FinalizeResult {
  task: Task;
  draftSkills: Skill[];
  draftFailures: Failure[];
  brief: ReviewBrief;
  adrs: AdrRecord[];
}

// ── Agent Runtime ──────────────────────────────────────────────

export type AgentSessionStatus =
  | "starting"
  | "running"
  | "waiting"
  | "blocked"
  | "exited"
  | "killed"
  | "failed";

export type TerminalDirection = "input" | "output" | "system";

export interface AgentProfile {
  id: string;
  kind: string;
  displayName: string;
  executable: string;
  defaultArgs: string[];
  available: boolean;
  version?: string;
  path?: string;
}

// ── Agent 配置中心（统一配置模型）───────────────────────

export type ProviderTargetApp = "claude" | "codex" | "gemini" | "universal";

export interface ProviderConfig {
  id: string;
  name: string;
  targetApp: ProviderTargetApp;
  model: string;
  endpoint: string;
  apiKey: string;
  isActive: boolean;
  notes?: string;
}

export interface TestProviderResult {
  success: boolean;
  message: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  isActive: boolean;
}

export type AgentConfigTargetType = "native_config" | "project_context";
export type AgentConfigFormat = "json" | "toml" | "markdown";

export interface AgentConfigTarget {
  id: string;
  agentId: string;
  targetType: AgentConfigTargetType;
  format: AgentConfigFormat;
  path: string;
  exists: boolean;
  description: string;
}

export interface AgentConfigContent {
  target: AgentConfigTarget;
  content: string;
}

export interface AgentConfigWriteResult {
  target: AgentConfigTarget;
  backupPath?: string | null;
  bytesWritten: number;
}

export interface AgentSession {
  id: string;
  taskId: string;
  profileId: string;
  agentId: string;
  status: AgentSessionStatus;
  cwd: string;
  commandLine: string;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  exitCode?: number;
  lastSeq: number;
}

export interface TerminalChunk {
  sessionId: string;
  seq: number;
  direction: TerminalDirection;
  text: string;
  createdAt: string;
}

export interface AgentSnapshot {
  session: AgentSession;
  chunks: TerminalChunk[];
  truncated: boolean;
  firstSeq: number | null;
  lastSeq: number | null;
}

export interface WorkspaceLock {
  id: string;
  repoPath: string;
  ownerSessionId: string;
  lockKind: "read" | "write";
  createdAt: string;
}

export interface Settings {
  dataDir: string;
  maxBackups: number;
  retrievalMode: RetrievalMode;
  guardMinScore: number;
  codexModel: string;
}

export interface HandoverInclude {
  events?: boolean;
  skills?: boolean;
  failures?: boolean;
  openQuestions?: string[];
}

// ── Tauri 事件 payload ─────────────────────────────────────────

export interface TerminalChunkPayload {
  sessionId: string;
  chunk: TerminalChunk;
}
export interface SessionStatusPayload {
  sessionId: string;
  session: AgentSession;
}
export interface ParsedEventPayload {
  sessionId: string;
  event: TaskEvent;
}
export interface BudgetPayload {
  sessionId: string;
  budget: BudgetStatus;
}
export interface SignatureHitPayload {
  sessionId: string;
  signature: string;
  guardRule: string;
  occurrences: number;
  line: string;
}

// 视图
export type ViewId =
  | "overview"
  | "demo"
  | "tasks"
  | "evidence"
  | "console"
  | "integrations"
  | "gate"
  | "memory"
  | "settings";

export type ToastKind = "info" | "success" | "warning" | "error";
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}
