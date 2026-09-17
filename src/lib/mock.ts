// 浏览器预览用的内存 mock(非 Tauri 环境)。种子数据对齐展示页叙事:任务 T-0417。
// 桌面端(Tauri)一切走真实后端,不触碰本文件。

import type {
  AdrRecord,
  AgentProfile,
  AgentConfigTarget,
  AgentRecommendation,
  AgentSession,
  AgentSnapshot,
  BlameReport,
  BudgetStatus,
  CandidateExtractionSummary,
  CandidateStatus,
  CommitLink,
  Failure,
  FailureCandidate,
  FinalizeResult,
  GuardResult,
  SkillCandidate,
  HistoryConversation,
  HistoryMessage,
  HistoryScanSummary,
  PendingCommand,
  McpServerConfig,
  PolicyDecision,
  PolicyVerdict,
  RankedSkill,
  ProviderConfig,
  ReviewBrief,
  Settings,
  Skill,
  Task,
  TaskEvent,
  TaskStatus,
} from "../types";

const now = () => new Date().toISOString();
const uid = (p: string) => `${p}-${Math.random().toString(36).slice(2, 9)}`;

// ── 任务 + 证据链 ─────────────────────────────────────────────

let TASKS: Task[] = [
  {
    id: "T-0417",
    title: "修复 Windows 构建失败",
    goal: "修复 Windows 构建失败;不引入新依赖,保持 CI 通过。",
    status: "verified",
    agentId: "claude_code",
    repoPath: "D:/repo",
    repoBranch: "main",
    repoCommit: "9a8b7c1",
    tags: ["build", "windows", "ci"],
    createdAt: "2026-07-12T13:40:00Z",
    updatedAt: "2026-07-12T14:12:00Z",
    closedAt: "2026-07-12T14:12:00Z",
  },
  {
    id: "T-0409",
    title: "构建管线重构",
    goal: "把构建入口统一为单函数,便于错误归一化。",
    status: "verified",
    agentId: "codex",
    repoPath: "D:/repo",
    repoBranch: "feat/build",
    repoCommit: "3c2d1e0",
    tags: ["build", "refactor"],
    createdAt: "2026-07-08T09:00:00Z",
    updatedAt: "2026-07-08T10:20:00Z",
    closedAt: "2026-07-08T10:20:00Z",
  },
  {
    id: "T-0421",
    title: "接入 JWT 鉴权",
    goal: "为 API 增加无状态 JWT 鉴权,支持水平扩展。",
    status: "in_progress",
    agentId: "claude_code",
    repoPath: "D:/repo",
    repoBranch: "feat/auth",
    repoCommit: "",
    tags: ["auth", "api"],
    createdAt: "2026-07-25T11:00:00Z",
    updatedAt: "2026-07-26T08:30:00Z",
  },
];

const EVENTS: Record<string, TaskEvent[]> = {
  "T-0417": mk("T-0417", [
    ["step", "ai", "安装依赖并触发首次构建", "pnpm install 完成"],
    ["decision", "ai", "改用 vcvars 环境注入而非硬编码路径", "硬编码路径在不同机器上不可移植;理由见证据 #12", "src-tauri/build.rs", "8-20"],
    ["error", "ai", "linker `link.exe` not found (os error 2)", "缺少 VS C++ 工具链;签名命中历史失败库(第 3 次)"],
    ["fix", "guard", "注入 vcvars 环境后重试构建", "由 Failure Guard 约束触发", "src-tauri/build.rs", "12-16"],
    ["decision", "ai", "链接器探测下沉到 build.rs", "集中在构建期解析,避免运行期猜路径", "src-tauri/build.rs", "1-4"],
    ["verification", "ai", "cargo test 34/34 通过", "release 构建产物校验一致;测试确实运行过——有终端流为证", undefined, undefined, "logs/test-run.txt"],
  ]),
  "T-0409": mk("T-0409", [
    ["step", "ai", "梳理现有构建入口", "散落在 3 处"],
    ["decision", "ai", "构建入口统一为单函数", "便于错误归一化与失败上下文冒泡"],
    ["verification", "ai", "CI 全绿", "GitHub Actions matrix 通过"],
  ]),
  "T-0421": mk("T-0421", [
    ["step", "ai", "选型 jsonwebtoken 库", undefined],
    ["decision", "ai", "采用无状态 JWT", "支持水平扩展,免会话粘性"],
    ["error", "ai", "401:token 校验在中间件初始化前执行", "初始化顺序问题"],
  ]),
};

function mk(
  taskId: string,
  rows: [TaskEvent["kind"], TaskEvent["actor"], string, string?, string?, string?, string?][],
): TaskEvent[] {
  return rows.map((r, i) => ({
    id: uid("ev"),
    taskId,
    seq: i + 1,
    kind: r[0],
    actor: r[1],
    summary: r[2],
    detail: r[3],
    anchorFile: r[4],
    anchorLines: r[5],
    evidenceRef: r[6],
    createdAt: now(),
  }));
}

export const listTasks = (a: { status?: TaskStatus } = {}) =>
  TASKS.filter((t) => (a.status ? t.status === a.status : true));
export const getTask = (id: string) => {
  const t = TASKS.find((x) => x.id === id);
  if (!t) throw new Error("task not found");
  return t;
};
export const createTask = (a: any): Task => {
  const t: Task = {
    id: uid("T"),
    title: a.title,
    goal: a.goal,
    status: "in_progress",
    agentId: a.agentId,
    repoPath: a.repoPath,
    repoBranch: a.repoBranch,
    repoCommit: a.repoCommit,
    tags: a.tags || [],
    createdAt: now(),
    updatedAt: now(),
  };
  TASKS = [t, ...TASKS];
  EVENTS[t.id] = [];
  return t;
};
export const updateTaskStatus = (id: string, status: TaskStatus) => {
  const t = getTask(id);
  t.status = status;
  t.updatedAt = now();
  if (["verified", "failed", "abandoned"].includes(status)) t.closedAt = t.updatedAt;
  return t;
};
export const listEvents = (taskId: string) => EVENTS[taskId] || [];
export const appendEvent = (a: any): TaskEvent => {
  const list = EVENTS[a.taskId] || (EVENTS[a.taskId] = []);
  const ev: TaskEvent = {
    id: uid("ev"),
    taskId: a.taskId,
    seq: list.length + 1,
    kind: a.kind,
    actor: a.actor || "human",
    summary: a.summary,
    detail: a.detail,
    evidenceRef: a.evidenceRef,
    anchorFile: a.anchorFile,
    anchorLines: a.anchorLines,
    createdAt: now(),
  };
  list.push(ev);
  return ev;
};

// ── Skill / Failure ───────────────────────────────────────────

let SKILLS: Skill[] = [
  {
    id: "SK-1",
    name: "Windows tauri 构建:link.exe 缺失",
    trigger: "涉及 [build, windows],且与「Windows 构建」相似的任务",
    body: "## 步骤\n1. 安装 VS Build Tools(C++ 桌面工作负载)\n2. 用 vcvars 注入环境\n## 如何验证\n- cargo build --release 产出 .msi",
    tags: ["build", "windows"],
    sourceTaskId: "T-0417",
    status: "active",
    version: 3,
    successCount: 7,
    failCount: 0,
    originAgent: "claude_code",
    originModel: "opus-4.8",
    freshness: "fresh",
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "SK-2",
    name: "IPC 契约漂移防护",
    trigger: "涉及 [ipc, tauri] 的任务",
    body: "## 步骤\n1. contracts/ipc-commands.md 为唯一事实来源\n2. Rust 结构 camelCase\n## 如何验证\n- 增加 roundtrip 测试",
    tags: ["ipc", "tauri"],
    sourceTaskId: "T-0409",
    status: "active",
    version: 2,
    successCount: 3,
    failCount: 1,
    originAgent: "codex",
    originModel: "gpt-5.1-codex",
    freshness: "needs_revalidation",
    createdAt: now(),
    updatedAt: now(),
  },
  {
    id: "SK-3",
    name: "FTS5 空 MATCH 崩溃防护",
    trigger: "涉及 [sqlite, fts5] 的任务",
    body: "## 步骤\n1. match_expr 为空时提前返回空\n## 如何验证\n- 空查询单测",
    tags: ["sqlite"],
    sourceTaskId: "T-0409",
    status: "draft",
    version: 1,
    successCount: 0,
    failCount: 0,
    originAgent: "claude_code",
    originModel: "opus-4.8",
    freshness: "fresh",
    createdAt: now(),
    updatedAt: now(),
  },
];

const FAILURES: Failure[] = [
  {
    id: "F-1",
    signature: "a3f2c9e1b8d47f60a1c2e3b4d5f6a7b8c9d0e1f2",
    description: "linker `link.exe` not found",
    rootCause: "缺少 VS C++ 工具链 / 未注入 vcvars 环境",
    fix: "安装 VS Build Tools 后用 vcvars 注入环境再构建",
    guardRule: "构建前确认装了 VS C++ 工具链,并注入 vcvars 环境",
    tags: ["build", "windows"],
    occurrences: 3,
    originAgent: "claude_code",
    originModel: "opus-4.8",
  },
  {
    id: "F-2",
    signature: "b7c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9",
    description: "401:JWT 中间件初始化顺序错误",
    rootCause: "token 校验在中间件初始化前执行",
    fix: "把鉴权中间件放到路由注册之前初始化",
    guardRule: "接入鉴权时,先初始化中间件再注册受保护路由",
    tags: ["auth", "api"],
    occurrences: 1,
    originAgent: "claude_code",
    originModel: "opus-4.8",
  },
];

export const listSkills = (a: { status?: Skill["status"] } = {}) =>
  SKILLS.filter((s) => (a.status ? s.status === a.status : true));
export const updateSkillStatus = (id: string, status: Skill["status"]) => {
  const s = SKILLS.find((x) => x.id === id)!;
  s.status = status;
  s.updatedAt = now();
  return s;
};
export const revalidateSkill = (id: string) => {
  const s = SKILLS.find((x) => x.id === id)!;
  s.freshness = "fresh";
  s.revalidatedAt = now();
  return s;
};
export const searchSkills = (a: { query: string }): RankedSkill[] => {
  const q = a.query.toLowerCase();
  return SKILLS.filter(
    (s) => s.name.toLowerCase().includes(q) || s.trigger.toLowerCase().includes(q),
  ).map((skill) => ({ skill, score: 0.6 }));
};
export const listFailures = () => FAILURES;
export const checkFailureGuard = (goal: string, tags?: string[]): GuardResult => {
  const g = goal.toLowerCase();
  const matched = FAILURES.filter(
    (f) => f.tags.some((t) => (tags || []).includes(t)) || f.description.toLowerCase().includes(g.slice(0, 4)),
  );
  return {
    matchedFailures: matched,
    suggestedSkills: SKILLS.filter((s) => s.status === "active").slice(0, 2),
    constraints: matched.map((f) => f.guardRule),
    handoverPrompt: matched.length ? "命中历史失败,已前置注入约束。" : "",
  };
};

// ── 海关 ──────────────────────────────────────────────────────

export const POLICY_TEXT = `schema_version = 1

[gate]
apply_to_input = true
scan_output = true
hold_timeout_secs = 120

[budget]
enabled = true
max_session_tokens = 500000
warn_ratio = 0.8

[redaction]
enabled = true

[[rules]]
id = "destructive_fs"
action = "hold"
title = "破坏性文件删除"
patterns = ['(?i)\\brm\\s+-rf\\b', '(?i)\\bRemove-Item\\b.*-Recurse.*-Force']

[[rules]]
id = "secret_egress"
action = "hold"
title = "密钥出站"
patterns = ['(?i)(curl|wget|iwr)\\b.*(\\.env\\b|id_rsa|token|secret)']

[[rules]]
id = "destructive_db"
action = "hold"
title = "高危 SQL"
patterns = ['(?i)\\bdrop\\s+(table|database)\\b', '(?i)\\btruncate\\b']

[[rules]]
id = "risky_git"
action = "warn"
title = "有损 Git 操作"
patterns = ['(?i)\\bgit\\s+push\\b.*(--force|-f)\\b', '(?i)\\bgit\\s+reset\\b.*--hard']
`;

let POLICY = POLICY_TEXT;
export const gateGetPolicyText = () => POLICY;
export const gateSetPolicyText = (text: string) => {
  POLICY = text;
};

const MOCK_RULES: { id: string; action: PolicyVerdict["action"]; title: string; re: RegExp }[] = [
  { id: "destructive_fs", action: "hold", title: "破坏性文件删除", re: /(rm\s+-rf|remove-item.*-recurse.*-force)/i },
  { id: "secret_egress", action: "hold", title: "密钥出站", re: /(curl|wget|iwr).*(\.env|id_rsa|token|secret)/i },
  { id: "destructive_db", action: "hold", title: "高危 SQL", re: /(drop\s+(table|database)|truncate)/i },
  { id: "risky_git", action: "warn", title: "有损 Git 操作", re: /(git\s+push.*(--force|-f)\b|git\s+reset.*--hard)/i },
];

export const gateTestCommand = (cmd: string): PolicyVerdict => {
  const order = { allow: 0, warn: 1, hold: 2, deny: 3 } as const;
  let best: PolicyVerdict = { action: "allow", reason: "无命中", matched: false };
  for (const r of MOCK_RULES) {
    if (r.re.test(cmd) && order[r.action] > order[best.action]) {
      best = { ruleId: r.id, action: r.action, reason: r.title, matched: true };
    }
  }
  return best;
};

let PENDING: PendingCommand[] = [];
let DECISIONS: PolicyDecision[] = [
  {
    id: uid("pd"),
    taskId: "T-0417",
    sessionId: "sess-1",
    ruleId: "destructive_fs",
    action: "hold",
    verdict: "denied",
    commandText: "rm -rf ~/repo",
    reason: "破坏性删除:目标位于受保护工作区",
    decidedBy: "human",
    createdAt: "2026-07-12T14:02:00Z",
    resolvedAt: "2026-07-12T14:02:10Z",
  },
  {
    id: uid("pd"),
    taskId: "T-0417",
    sessionId: "sess-1",
    ruleId: "risky_git",
    action: "warn",
    verdict: "warned",
    commandText: "git push --force origin feat/x",
    reason: "有损 Git 操作",
    decidedBy: "policy",
    createdAt: "2026-07-12T14:05:00Z",
    resolvedAt: "2026-07-12T14:05:00Z",
  },
];

export const gateListPending = () => PENDING;
export const gateListDecisions = (a: { taskId?: string; sessionId?: string } = {}) =>
  DECISIONS.filter(
    (d) => (a.taskId ? d.taskId === a.taskId : true) && (a.sessionId ? d.sessionId === a.sessionId : true),
  );
export const gateResolvePending = (pendingId: string, approve: boolean): PolicyDecision => {
  const p = PENDING.find((x) => x.id === pendingId);
  PENDING = PENDING.filter((x) => x.id !== pendingId);
  const d: PolicyDecision = {
    id: uid("pd"),
    taskId: p?.taskId,
    sessionId: p?.sessionId,
    ruleId: p?.ruleId || "unknown",
    action: "hold",
    verdict: approve ? "approved" : "denied",
    commandText: p?.commandText || "",
    reason: p?.reason || "",
    decidedBy: "human",
    createdAt: now(),
    resolvedAt: now(),
  };
  DECISIONS = [d, ...DECISIONS];
  return d;
};
export const gateGetBudget = (): BudgetStatus => ({
  enabled: true,
  maxSessionTokens: 500000,
  usedTokens: 182000,
  ratio: 0.364,
  breakerTripped: false,
});

// ── Brief / ADR / Blame ───────────────────────────────────────

export const compileBrief = (taskId: string): ReviewBrief => {
  const t = getTask(taskId);
  const evs = listEvents(taskId);
  return {
    taskId,
    title: t.title,
    goal: t.goal,
    status: t.status,
    generatedAt: now(),
    decisions: evs
      .filter((e) => e.kind === "decision")
      .map((e) => ({ summary: e.summary, reason: e.detail, actor: e.actor })),
    errorsFixed: evs
      .filter((e) => e.kind === "error")
      .map((e) => ({ error: e.summary, fix: "已按既有约束修复", signature: "a3f2c9…", recurrences: 3 })),
    verifications: evs
      .filter((e) => e.kind === "verification")
      .map((e) => ({ summary: e.summary, evidenceRef: e.evidenceRef })),
    interceptions: gateListDecisions({ taskId }),
    risks: evs.some((e) => e.kind === "verification")
      ? ["ARM64 路径未覆盖验证;建议合入前补一条 CI matrix。"]
      : ["未记录任何验证证据——无法确认改动真的跑过测试。"],
    stats: {
      events: evs.length,
      sessions: 1,
      tokensEst: 182000,
      humanConfirmed: evs.filter((e) => e.actor === "human").length,
      aiProposed: evs.filter((e) => e.actor === "ai").length,
      durationSecs: 1920,
    },
    markdown: `# Review Brief · ${t.title}\n\n> 任务 ${taskId} · 状态 ${t.status}\n\n## GOAL\n${t.goal}\n`,
  };
};

const ADRS: AdrRecord[] = [
  {
    id: uid("adr"),
    taskId: "T-0417",
    number: 23,
    title: "链接器探测下沉到 build.rs",
    status: "accepted",
    context: "任务目标:修复 Windows 构建失败",
    decision: "在构建期集中解析链接器路径,避免运行期猜路径。\n\n理由:硬编码不可移植。",
    consequences: "构建脚本复杂度略增,换来跨机器可移植性。",
    sourceEventId: "ev-x",
    filePath: "adr/0023-链接器探测下沉到-build-rs.md",
    createdAt: now(),
  },
  {
    id: uid("adr"),
    taskId: "T-0409",
    number: 18,
    title: "构建入口统一为单函数",
    status: "accepted",
    context: "任务目标:构建管线重构",
    decision: "把散落的构建入口收敛为单函数,便于错误归一化。",
    consequences: "调用点需要适配。",
    sourceEventId: "ev-y",
    filePath: "adr/0018-构建入口统一为单函数.md",
    createdAt: now(),
  },
];
export const listAdrs = (taskId?: string) => ADRS.filter((a) => (taskId ? a.taskId === taskId : true));

const COMMITS: CommitLink[] = [
  {
    id: uid("cl"),
    taskId: "T-0417",
    sessionId: "sess-1",
    repoPath: "D:/repo",
    commitHash: "9a8b7c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b",
    subject: "fix: 注入 vcvars 修复 Windows 构建",
    author: "claude-code",
    committedAt: "2026-07-12T14:10:00Z",
    createdAt: now(),
  },
  {
    id: uid("cl"),
    taskId: "T-0409",
    sessionId: "sess-0",
    repoPath: "D:/repo",
    commitHash: "3c2d1e0f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d",
    subject: "refactor: 统一构建入口",
    author: "codex",
    committedAt: "2026-07-08T10:15:00Z",
    createdAt: now(),
  },
];
export const listCommitLinks = (taskId: string) => COMMITS.filter((c) => c.taskId === taskId);
export const scanRepoCommits = () => COMMITS;

// 展示页同款代码行 → blame
const BLAME_LINES: Record<number, BlameReport> = {};
const CODE: [number, string, string][] = [
  [1, "T-0417", "fn detect_linker() -> Result<PathBuf> {"],
  [3, "T-0417", "    let vs = vcvars_env().context(\"vcvars not found\")?;"],
  [8, "T-0409", "pub fn build() -> Result<()> {"],
];
export const blameLine = (file: string, line: number): BlameReport => {
  const hit = CODE.find(([l]) => l === line) || CODE[0];
  const taskId = hit[1];
  const t = TASKS.find((x) => x.id === taskId);
  const evs = listEvents(taskId);
  return {
    file,
    line,
    commitHash: taskId === "T-0417" ? "9a8b7c1d" : "3c2d1e0f",
    commitSubject: taskId === "T-0417" ? "fix: 注入 vcvars 修复 Windows 构建" : "refactor: 统一构建入口",
    commitAuthor: taskId === "T-0417" ? "claude-code" : "codex",
    linked: true,
    task: t,
    sessions: [
      {
        id: "sess-1",
        agentId: t?.agentId || "claude_code",
        commandLine: `${t?.agentId} (opus-4.8)`,
        startedAt: t?.createdAt || now(),
        endedAt: t?.updatedAt,
        exitCode: 0,
      },
    ],
    decisions: evs.filter((e) => e.kind === "decision"),
    humanConfirmations: evs.filter((e) => e.actor === "human"),
    guardEvents: evs.filter((e) => e.actor === "guard"),
    adrs: listAdrs(taskId),
  };
};
void BLAME_LINES;

// ── 路由 ──────────────────────────────────────────────────────

export const recommendAgents = (): AgentRecommendation[] => [
  {
    agentKind: "claude_code",
    score: 1.42,
    successCount: 10,
    failCount: 0,
    taskCount: 6,
    reasons: ["历史成败 10/0(平滑胜率 92%)", "覆盖 6 个不同任务", "在相似任务上有 2 条可复用经验"],
  },
  {
    agentKind: "codex",
    score: 0.88,
    successCount: 4,
    failCount: 2,
    taskCount: 3,
    reasons: ["历史成败 4/2(平滑胜率 63%)", "覆盖 3 个不同任务"],
  },
];

// ── Agent Runtime(预览用最小实现) ────────────────────────────

export const detectAgents = (): AgentProfile[] => [
  { id: "claude_code", kind: "claude_code", displayName: "Claude Code", executable: "claude", defaultArgs: [], available: true, version: "preview" },
  { id: "codex", kind: "codex", displayName: "Codex CLI", executable: "codex", defaultArgs: [], available: true, version: "preview" },
  { id: "gemini", kind: "gemini", displayName: "Gemini CLI", executable: "gemini", defaultArgs: [], available: true, version: "preview" },
  { id: "opencode", kind: "opencode", displayName: "OpenCode", executable: "opencode", defaultArgs: [], available: true, version: "preview" },
  { id: "shell", kind: "shell", displayName: "Shell", executable: "powershell", defaultArgs: [], available: true, version: "preview" },
];

let SESSIONS: AgentSession[] = [];
const CHUNKS: Record<string, AgentSnapshot["chunks"]> = {};
export const startAgentSession = (a: any): AgentSession => {
  const s: AgentSession = {
    id: uid("sess"),
    taskId: a.taskId,
    profileId: a.profileId,
    agentId: a.profileId,
    status: "running",
    cwd: a.cwd || ".",
    commandLine: `${a.profileId}`,
    startedAt: now(),
    updatedAt: now(),
    lastSeq: 1,
  };
  SESSIONS = [s, ...SESSIONS];
  CHUNKS[s.id] = [
    {
      sessionId: s.id,
      seq: 1,
      direction: "system",
      text: "浏览器预览会话:真实 Codex/Claude 启动请在 Tauri 桌面端。\r\n",
      createdAt: now(),
    },
  ];
  return s;
};
export const sendAgentInput = (sessionId: string, text: string) => {
  const c = CHUNKS[sessionId] || (CHUNKS[sessionId] = []);
  c.push({ sessionId, seq: c.length + 1, direction: "input", text, createdAt: now() });
};
export const stopAgentSession = (sessionId: string) => {
  const s = SESSIONS.find((x) => x.id === sessionId)!;
  s.status = "killed";
  s.endedAt = now();
  return s;
};
export const listAgentSessions = (a: { taskId?: string } = {}) =>
  SESSIONS.filter((s) => (a.taskId ? s.taskId === a.taskId : true));
export const getAgentSnapshot = (sessionId: string): AgentSnapshot => ({
  session: SESSIONS.find((x) => x.id === sessionId)!,
  chunks: CHUNKS[sessionId] || [],
});
export const listWorkspaceLocks = () => [];
export const buildStartupContext = (a: any) => ({
  task: getTask(a.taskId),
  prompt: `# Launch Context - ${getTask(a.taskId).title}\n\n(浏览器预览)`,
  tokensEst: 1200,
  constraints: checkFailureGuard(getTask(a.taskId).goal, getTask(a.taskId).tags).constraints,
  matchedFailures: [],
  suggestedSkills: [],
  parts: [],
});

// ── Agent 配置中心（浏览器预览）────────────────────────

let PROVIDERS: ProviderConfig[] = [
  {
    id: "provider-official-codex",
    name: "OpenAI Official",
    targetApp: "codex",
    model: "gpt-5.6-codex",
    endpoint: "https://api.openai.com",
    apiKey: "",
    isActive: true,
    notes: "Codex 默认上游",
  },
  {
    id: "provider-anthropic",
    name: "Anthropic Official",
    targetApp: "claude",
    model: "claude-opus-4-1",
    endpoint: "https://api.anthropic.com",
    apiKey: "",
    isActive: true,
    notes: "Claude Code 默认上游",
  },
];

let MCP_SERVERS: McpServerConfig[] = [
  { id: "mcp-ael", name: "AEL Memory", command: "ael-mcp", args: ["serve"], env: {}, isActive: true },
  { id: "mcp-github", name: "GitHub", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: {}, isActive: false },
];

const CONFIG_TARGETS: AgentConfigTarget[] = [
  { id: "codex_global", agentId: "codex", targetType: "native_config", format: "toml", path: "~/.codex/config.toml", exists: true, description: "Codex global config.toml" },
  { id: "codex_project", agentId: "codex", targetType: "project_context", format: "markdown", path: "D:/repo/AGENTS.md", exists: true, description: "Codex/shared project instructions" },
  { id: "claude_global", agentId: "claude_code", targetType: "native_config", format: "json", path: "~/.claude/settings.json", exists: true, description: "Claude Code global settings.json" },
  { id: "claude_project", agentId: "claude_code", targetType: "project_context", format: "markdown", path: "D:/repo/CLAUDE.md", exists: false, description: "Claude Code project instructions" },
  { id: "gemini_global", agentId: "gemini", targetType: "native_config", format: "json", path: "~/.gemini/settings.json", exists: false, description: "Gemini CLI global settings.json" },
];

const CONFIG_CONTENT: Record<string, string> = {
  codex_global: 'model = "gpt-5.6-codex"\nmodel_reasoning_effort = "high"\n',
  codex_project: "# Project instructions\n\nUse AEL memory before starting work.\n",
  claude_global: '{\n  "permissions": { "defaultMode": "acceptEdits" }\n}\n',
};

export const listProviders = () => PROVIDERS;
export const saveProvider = (provider: ProviderConfig) => {
  const next = { ...provider, id: provider.id || uid("provider") };
  PROVIDERS = PROVIDERS.some((item) => item.id === next.id)
    ? PROVIDERS.map((item) => item.id === next.id ? next : item)
    : [next, ...PROVIDERS];
};
export const testProvider = (providerId: string) => ({ success: true, message: `${PROVIDERS.find((item) => item.id === providerId)?.name || "Provider"} 连接正常（浏览器预览）` });
export const listMcpServers = () => MCP_SERVERS;
export const saveMcpServer = (server: McpServerConfig) => {
  const next = { ...server, id: server.id || uid("mcp") };
  MCP_SERVERS = MCP_SERVERS.some((item) => item.id === next.id)
    ? MCP_SERVERS.map((item) => item.id === next.id ? next : item)
    : [next, ...MCP_SERVERS];
};
export const listAgentConfigTargets = (_cwd?: string) => CONFIG_TARGETS;
export const readAgentConfigTarget = (targetId: string) => ({ target: CONFIG_TARGETS.find((item) => item.id === targetId)!, content: CONFIG_CONTENT[targetId] || "" });
export const writeAgentConfigTarget = (targetId: string, content: string) => {
  CONFIG_CONTENT[targetId] = content;
  const target = CONFIG_TARGETS.find((item) => item.id === targetId)!;
  target.exists = true;
  return { target, backupPath: `~/.ael/backups/config/${targetId}.bak`, bytesWritten: content.length };
};
export const backupAgentConfigTarget = (targetId: string) => `~/.ael/backups/config/${targetId}.bak`;

export const finalizeTask = (id: string): FinalizeResult => {
  const t = updateTaskStatus(id, "verified");
  return {
    task: t,
    draftSkills: [SKILLS[0]],
    draftFailures: [FAILURES[0]],
    brief: compileBrief(id),
    adrs: listAdrs(id),
  };
};

// ── 本机历史索引预览 ─────────────────────────────────────────

const MOCK_HISTORY: HistoryConversation = {
  id: "hist-preview-1",
  sourceAgent: "codex",
  sourcePath: "~/.codex/sessions/preview.jsonl",
  sourceSessionId: "preview-session",
  title: "浏览器预览历史会话",
  repoPath: "D:/repo",
  createdAt: "2026-09-16T08:00:00Z",
  updatedAt: "2026-09-16T08:30:00Z",
  messageCount: 2,
  sourceHash: "preview",
};

export const historyScanSummary = (): HistoryScanSummary => ({
  id: "scan-preview",
  startedAt: "2026-09-16T08:30:00Z",
  endedAt: "2026-09-16T08:30:01Z",
  filesSeen: 1,
  conversations: 1,
  messages: 2,
  sourceCounts: { codex: { sourceAgent: "codex", sessions: 1, messages: 2 } },
  newCandidates: 0,
});
export const historyConversations = () => [MOCK_HISTORY];
export const historyMessages = (conversationId: string): HistoryMessage[] => [
  { id: "hist-msg-preview-1", conversationId, role: "user", kind: "message", text: "请检查构建错误", createdAt: MOCK_HISTORY.createdAt },
  { id: "hist-msg-preview-2", conversationId, role: "assistant", kind: "message", text: "已记录检查结果，等待人工确认。", createdAt: MOCK_HISTORY.updatedAt },
];

let MOCK_SKILL_CANDIDATES: SkillCandidate[] = [];
let MOCK_FAILURE_CANDIDATES: FailureCandidate[] = [];
const ensureMockCandidates = () => {
  if (MOCK_SKILL_CANDIDATES.length > 0 || MOCK_FAILURE_CANDIDATES.length > 0) return;
  const createdAt = now();
  MOCK_SKILL_CANDIDATES = [{
    id: "skill-candidate-preview",
    name: "构建失败后的验证闭环",
    triggerText: "遇到 Windows 构建失败时，先记录根因并在修复后执行完整验证",
    scope: "D:/repo",
    problem: "构建错误被修复后容易遗漏可复现的验证步骤",
    steps: ["记录原始错误并归一化", "执行修复", "运行测试和 release 构建"],
    antiPatterns: ["未经人工确认不得进入 active 记忆"],
    verification: ["cargo test 通过", "release 构建产物存在"],
    tags: ["build", "verification"],
    sourceSessions: [MOCK_HISTORY.sourceSessionId],
    sourceMessages: ["hist-msg-preview-1", "hist-msg-preview-2"],
    sourceErrors: [],
    sourceCommits: [],
    confidence: 0.82,
    status: "candidate",
    createdByAgent: "deterministic-history-extractor",
    createdAt,
    updatedAt: createdAt,
  }];
  MOCK_FAILURE_CANDIDATES = [{
    id: "failure-candidate-preview",
    signature: "preview-failure-signature",
    normalizedText: "linker not found",
    description: "Windows 构建时缺少 linker",
    rootCause: "C++ 工具链环境未加载",
    fix: "加载 vcvars 环境后重新构建",
    guardRule: "构建前确认 C++ 工具链和 vcvars 环境可用",
    verification: ["重新执行构建并产出安装包"],
    tags: ["build", "windows"],
    sourceSessions: [MOCK_HISTORY.sourceSessionId],
    sourceMessages: ["hist-msg-preview-1", "hist-msg-preview-2"],
    sourceErrors: ["hist-msg-preview-1"],
    sourceCommits: [],
    confidence: 0.76,
    status: "candidate",
    createdByAgent: "deterministic-history-extractor",
    createdAt,
    updatedAt: createdAt,
  }];
};
export const extractHistoryCandidates = (): CandidateExtractionSummary => {
  ensureMockCandidates();
  return {
    skillCandidates: MOCK_SKILL_CANDIDATES.length,
    failureCandidates: MOCK_FAILURE_CANDIDATES.length,
    skippedLowEvidence: 0,
  };
};
export const distillHistoryCandidates = (): CandidateExtractionSummary => extractHistoryCandidates();
export const skillCandidates = (status?: CandidateStatus) =>
  status ? MOCK_SKILL_CANDIDATES.filter((item) => item.status === status) : MOCK_SKILL_CANDIDATES;
export const failureCandidates = (status?: CandidateStatus) =>
  status ? MOCK_FAILURE_CANDIDATES.filter((item) => item.status === status) : MOCK_FAILURE_CANDIDATES;
export const updateSkillCandidateStatus = (id: string, status: CandidateStatus) => {
  const item = MOCK_SKILL_CANDIDATES.find((candidate) => candidate.id === id);
  if (!item) throw new Error("候选不存在");
  item.status = status;
  return item;
};
export const updateFailureCandidateStatus = (id: string, status: CandidateStatus) => {
  const item = MOCK_FAILURE_CANDIDATES.find((candidate) => candidate.id === id);
  if (!item) throw new Error("候选不存在");
  item.status = status;
  return item;
};
export const promoteSkillCandidate = (id: string): Skill => {
  const candidate = MOCK_SKILL_CANDIDATES.find((item) => item.id === id);
  if (!candidate) throw new Error("候选不存在");
  candidate.status = "accepted";
  const skill: Skill = {
    id: `SK-${candidate.id}`,
    name: candidate.name,
    trigger: candidate.triggerText,
    body: `## 问题\n${candidate.problem}\n\n## 步骤\n${candidate.steps.map((step, i) => `${i + 1}. ${step}`).join("\n")}\n\n## 如何验证\n${candidate.verification.map((item) => `- ${item}`).join("\n")}`,
    tags: candidate.tags,
    sourceTaskId: undefined,
    status: "draft",
    version: 1,
    successCount: 0,
    failCount: 0,
    originAgent: candidate.createdByAgent,
    originModel: undefined,
    freshness: "fresh",
    createdAt: candidate.createdAt,
    updatedAt: now(),
  };
  SKILLS = [skill, ...SKILLS];
  return skill;
};
export const promoteFailureCandidate = (id: string): Failure => {
  const candidate = MOCK_FAILURE_CANDIDATES.find((item) => item.id === id);
  if (!candidate) throw new Error("候选不存在");
  candidate.status = "accepted";
  const failure: Failure = {
    id: `F-${candidate.id}`,
    signature: candidate.signature,
    description: candidate.description,
    rootCause: candidate.rootCause,
    fix: candidate.fix,
    guardRule: candidate.guardRule,
    tags: candidate.tags,
    occurrences: 1,
    originAgent: candidate.createdByAgent,
    originModel: undefined,
  };
  FAILURES.push(failure);
  return failure;
};

// ── 设置 ──────────────────────────────────────────────────────

export let SETTINGS: Settings = {
  dataDir: "~/.ael",
  maxBackups: 10,
  retrievalMode: "keyword",
  guardMinScore: 0.35,
};
export const setSettings = (a: Partial<Settings>): Settings => {
  SETTINGS = { ...SETTINGS, ...a };
  return SETTINGS;
};
