export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'verified' | 'failed' | 'abandoned';
export type EventKind = 'step' | 'error' | 'fix' | 'verification' | 'decision' | 'note';
export type SkillStatus = 'draft' | 'active' | 'deprecated';
export interface AgentConfigTarget {
  id: string;
  name: string;
  agentKind: string;
  type: string;
  path: string;
  description: string;
  backupPath?: string;
}

export type AgentConfigFormat = 'json' | 'toml' | 'markdown';

export interface AgentConfigContent {
  target: AgentConfigTarget;
  format: AgentConfigFormat;
  content: string;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  authStrategy: 'env' | 'db' | 'oauth';
  baseUrl?: string;
  status: 'active' | 'inactive' | 'error';
  isActive?: boolean;
  targetApp?: string;
  model?: string;
  endpoint?: string;
  apiKey?: string;
}

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  status: 'running' | 'stopped' | 'failed';
  isActive?: boolean;
}

export type FailureStatus = 'active' | 'configured' | 'logged';
export type RetrievalMode = 'keyword' | 'hybrid';
export type SkillUsageOutcome = 'helped' | 'neutral' | 'harmful';
export type AgentSessionStatus =
  | 'starting'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'exited'
  | 'killed'
  | 'failed';
export type TerminalDirection = 'input' | 'output' | 'system';
export type WorkspaceLockKind = 'read' | 'write';
export type AppTab = 'tasks' | 'agents' | 'skills' | 'failures' | 'settings';

export interface TimelineEvent {
  id: string;
  type: string;
  title: string;
  timestamp: string;
  description: string;
  extraCode?: string;
  extraLink?: { label: string; url: string };
  fileAttachment?: string;
}

export interface Task {
  id: string;
  title: string;
  goal?: string;
  status: TaskStatus;
  agentId?: string;
  repoPath?: string;
  repoBranch?: string;
  repoCommit?: string;
  tags?: string[];
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string;

  // UI compatibility
  description?: string;
  agentName?: string;
  priority?: string;
  updateTimeAgo?: string;
  timeElapsed?: string;
  timeline?: TimelineEvent[];
  derivedSkills?: string[];
  relatedFailuresRef?: string[];
}

export interface TaskEvent {
  id: string;
  taskId: string;
  seq: number;
  kind: EventKind;
  summary: string;
  detail?: string;
  evidenceRef?: string;
  createdAt: string;
}

export interface Skill {
  id: string;
  name: string;
  trigger: string;
  body?: string;
  tags?: string[];
  sourceTaskId?: string;
  status: SkillStatus;
  version?: number;
  successCount?: number | '-';
  failCount?: number | '-';
  createdAt?: string;
  updatedAt?: string;

  // UI compatibility
  failureCount?: number | '-';
}

export interface Failure {
  id: string;
  signature?: string;
  description?: string;
  rootCause?: string;
  fix?: string;
  guardRule?: string;
  tags?: string[];
  occurrences: number;

  // UI compatibility
  status?: FailureStatus;
  name?: string;
  repairMethod?: string;
  constraint?: string;
  autoRepairActive?: boolean;
  upcomingAlertConfigured?: boolean;
  errorSignature?: string;
}

export type FailureDefense = Failure;

export interface GuardResult {
  matchedFailures: Failure[];
  suggestedSkills?: Skill[];
  constraints: string[];
  handoverPrompt: string;
}

export interface RankedSkill {
  skill: Skill;
  score: number;
}

export interface FinalizeResult {
  task: Task;
  draftSkills: Skill[];
  draftFailures: Failure[];
}

export interface HandoverInclude {
  events?: boolean;
  skills?: boolean;
  failures?: boolean;
  openQuestions?: string[];
}

export interface Settings {
  dataDir: string;
  maxBackups: number;
  retrievalMode: RetrievalMode;
  guardMinScore: number;
}

export interface AgentProfile {
  id: string;
  kind: string;
  displayName: string;
  executable: string;
  defaultArgs: string[];
  available: boolean;
  version: string;
  path: string;
  capabilities?: string[];
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
}

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

export interface WorkspaceLock {
  id: string;
  repoPath: string;
  ownerSessionId: string;
  lockKind: WorkspaceLockKind;
  createdAt: string;
}
