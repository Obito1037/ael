# Tauri IPC 命令签名 · v2(治理层)

前端 ↔ 后端之间的契约。v1 部分保持冻结不动;v2 治理层命令见文末「治理层(2.0)」章节。改动须先改本文件并通知前后端两侧。

## 全局约定（所有命令通用）

1. **序列化**:Rust 端所有 `#[derive(Serialize, Deserialize)]` 结构体加 `#[serde(rename_all = "camelCase")]`,与下面的 TS 类型逐字段对齐。
2. **错误**:每个命令在 Rust 侧返回 `Result<T, AelError>`。失败时 `invoke` 的 Promise reject,前端收到 `AelError`:
   ```ts
   interface AelError { code: string; message: string }
   // code 取值: not_found | invalid_input | conflict | io_error | internal
   ```
3. **ID**:全部 uuid v4(字符串)。**时间戳**:ISO-8601 UTC 文本(如 `2026-06-07T12:00:00Z`)。
4. **字段映射**:SQL 列 `trigger_text` 对应这里的 IPC/JSON 字段 `trigger`(数据层负责转换)。
5. **分页**:列表类命令统一 `{ limit?: number = 50, offset?: number = 0 }`。

## 类型

```ts
type TaskStatus  = 'pending' | 'in_progress' | 'blocked' | 'verified' | 'failed' | 'abandoned';
type EventKind   = 'step' | 'error' | 'fix' | 'verification' | 'decision' | 'note';
type SkillStatus = 'draft' | 'active' | 'deprecated';
type Outcome     = 'helped' | 'neutral' | 'harmful';

interface Task {
  id: string; title: string; goal: string; status: TaskStatus;
  agentId?: string; repoPath?: string; repoBranch?: string; repoCommit?: string;
  tags: string[]; createdAt: string; updatedAt: string; closedAt?: string;
}
interface TaskEvent {
  id: string; taskId: string; seq: number; kind: EventKind;
  summary: string; detail?: string; evidenceRef?: string; createdAt: string;
}
interface Skill {
  id: string; name: string; trigger: string; body: string; tags: string[];
  sourceTaskId?: string; status: SkillStatus; version: number;
  successCount: number; failCount: number; createdAt: string; updatedAt: string;
}
interface Failure {
  id: string; signature: string; description: string; rootCause?: string;
  fix?: string; guardRule: string; tags: string[]; occurrences: number;
}
```

## 任务

| 命令 | 入参 | 出参 |
|---|---|---|
| `create_task` | `{ title, goal, agentId?, repoPath?, repoBranch?, repoCommit?, tags? }` | `Task` |
| `get_task` | `{ id }` | `Task` |
| `list_tasks` | `{ status?, limit?, offset? }` | `Task[]` |
| `update_task_status` | `{ id, status }` | `Task` |
| `append_event` | `{ taskId, kind, summary, detail?, evidenceRef? }` | `TaskEvent`（seq 由后端分配） |
| `list_events` | `{ taskId }` | `TaskEvent[]`（按 seq 升序） |
| `finalize_task` | `{ id }` | `FinalizeResult` |

```ts
// finalize 触发经验提炼,返回待人工确认的草案(均为 draft)
interface FinalizeResult {
  task: Task;
  draftSkills: Skill[];      // status='draft'
  draftFailures: Failure[];  // 新增或合并(occurrences+1)的失败
}
```

## Skill 生命周期

| 命令 | 入参 | 出参 |
|---|---|---|
| `list_skills` | `{ status?, limit?, offset? }` | `Skill[]` |
| `get_skill` | `{ id }` | `Skill` |
| `create_skill` | `{ name, trigger, body, tags?, sourceTaskId? }` | `Skill` |
| `update_skill` | `{ id, name?, trigger?, body?, tags? }` | `Skill`（version+1） |
| `update_skill_status` | `{ id, status }` | `Skill` |
| `record_skill_usage` | `{ skillId, taskId, outcome }` | `void`（计数由 DB 触发器维护） |

## 检索 + Failure Guard（核心）

| 命令 | 入参 | 出参 |
|---|---|---|
| `search_skills` | `{ query, status?, limit? }` | `RankedSkill[]` |
| `check_failure_guard` | `{ goal, tags? }` | `GuardResult` |

```ts
interface RankedSkill { skill: Skill; score: number }   // score 0..1,已过最低阈值

// 新任务开始时调用一次,返回要注入 Agent 的全部上下文
interface GuardResult {
  matchedFailures: Failure[];     // 命中的历史失败
  suggestedSkills: Skill[];       // 相关 active Skill
  constraints: string[];          // 注入到 Agent 系统约束的条目(来自 guardRule)
  handoverPrompt: string;         // 可直接喂给 Agent 的提醒文本
}
```

## 接手包

| 命令 | 入参 | 出参 |
|---|---|---|
| `export_handover` | `{ taskId, include? }` | `{ path }`（生成 `~/.ael/handovers/<taskId>.zip`） |
| `import_handover` | `{ path }` | `{ taskId }` |
| `generate_handover_prompt` | `{ taskId }` | `{ prompt }` |

```ts
// 导出时可选包含项,默认全选
interface HandoverInclude {
  events?: boolean; skills?: boolean; failures?: boolean; openQuestions?: string[];
}
```

## 设置 / 维护

| 命令 | 入参 | 出参 |
|---|---|---|
| `get_settings` | `{}` | `Settings` |
| `set_settings` | `Partial<Settings>` | `Settings` |
| `backup_now` | `{}` | `{ path }` |

```ts
interface Settings {
  dataDir: string;            // 默认 ~/.ael
  maxBackups: number;         // 默认 10
  retrievalMode: 'keyword' | 'hybrid';  // MVP 用 keyword,后续 hybrid(见 DECISIONS.md)
  guardMinScore: number;      // 注入前的最低相关度阈值,默认 0.35
}
```

---

# 治理层(2.0)· 新增命令

v2 扩展既有类型(全部向后兼容,新字段可选或有默认值):

```ts
type EventActor = 'ai' | 'human' | 'guard' | 'system';
type Freshness  = 'fresh' | 'needs_revalidation';

interface TaskEvent {           // v2 追加
  actor: EventActor;            // 责任方,默认 'ai'
  sessionId?: string;           // 产生证据的会话
  anchorFile?: string;          // 行级锚点(Agent Blame)
  anchorLines?: string;         // 如 "12-40"
}
interface Skill {               // v2 追加(经验保鲜期)
  originAgent?: string;         // 产生经验的 Agent kind
  originModel?: string;         // 产生经验时的模型/工具版本
  freshness: Freshness;         // 模型换代 → needs_revalidation
  revalidatedAt?: string;
}
interface Failure {             // v2 追加
  originAgent?: string; originModel?: string;
}
// append_event 入参追加:{ actor?, sessionId?, anchorFile?, anchorLines? }
```

## 出口 ③ · 运行时海关(policy gate)

| 命令 | 入参 | 出参 |
|---|---|---|
| `get_policy` | `{}` | `{ path, content, policy: PolicySummary }`(~/.ael/policy.toml) |
| `save_policy` | `{ content }` | 同上(先校验 TOML + 正则,非法即拒) |
| `test_policy` | `{ command }` | `PolicyVerdict`(试运行一条命令,不落账本) |
| `list_pending_commands` | `{ sessionId? }` | `PendingCommand[]`(当前扣在裁决线上的命令) |
| `resolve_pending_command` | `{ pendingId, approve }` | `PolicyDecision`(放行→写入 PTY;拦截→丢弃;都留痕) |
| `list_policy_decisions` | `{ sessionId?, taskId?, limit?, offset? }` | `PolicyDecision[]`(海关账本) |
| `get_session_budget` | `{ sessionId }` | `BudgetStatus` |

```ts
type PolicyAction  = 'allow' | 'warn' | 'hold' | 'deny';
type PolicyVerdictKind = 'passed' | 'warned' | 'approved' | 'denied' | 'auto_denied';

interface PolicyVerdict { ruleId?: string; action: PolicyAction; reason: string; matched: boolean }
interface PendingCommand {
  id: string; sessionId: string; taskId: string; commandText: string;
  ruleId: string; reason: string; createdAt: string; timeoutSecs: number;
}
interface PolicyDecision {
  id: string; sessionId?: string; taskId?: string; ruleId: string;
  action: PolicyAction; verdict: PolicyVerdictKind; commandText: string;
  reason: string; decidedBy: 'policy' | 'human'; createdAt: string; resolvedAt?: string;
}
interface BudgetStatus {
  enabled: boolean; maxSessionTokens: number; usedTokens: number;
  ratio: number; breakerTripped: boolean;
}
```

Tauri 事件(后端 → 前端):
- `agent://policy-hold` `{ sessionId, pending: PendingCommand }` —— 命令被扣留
- `agent://policy-decision` `{ sessionId, decision: PolicyDecision }` —— 每次裁决落账
- `agent://guard-hit` `{ sessionId, failure: Failure, injected: boolean }` —— 输出流实时签名命中

## 出口 ① · Review Brief

| 命令 | 入参 | 出参 |
|---|---|---|
| `generate_brief` | `{ taskId }` | `ReviewBrief` |
| `export_brief` | `{ taskId }` | `{ path }`(写 `~/.ael/briefs/<taskId>.md`) |

```ts
interface ReviewBrief {
  taskId: string; title: string; goal: string; status: TaskStatus;
  generatedAt: string;
  decisions:   { summary: string; reason?: string; actor: EventActor }[];
  errorsFixed: { error: string; fix?: string; signature?: string; recurrences: number }[];
  verifications: { summary: string; evidenceRef?: string }[];
  interceptions: PolicyDecision[];           // 海关拦截记录
  risks: string[];                           // 未验证路径 / 未决问题
  stats: { events: number; sessions: number; tokensEst: number;
           humanConfirmed: number; aiProposed: number; durationSecs?: number };
  markdown: string;                          // 渲染好的一页 brief
}
```

## 出口 ② · Agent Blame(行级溯源)

| 命令 | 入参 | 出参 |
|---|---|---|
| `get_commit_trailer` | `{ taskId }` | `{ trailer }`(`AEL-Task: <id>` 文本,贴进 commit message) |
| `link_commit` | `{ taskId, repoPath, commitHash?, sessionId? }` | `CommitLink`(缺 hash 时取 HEAD) |
| `scan_task_commits` | `{ taskId, repoPath }` | `CommitLink[]`(git log --grep 自动回填) |
| `list_commit_links` | `{ taskId }` | `CommitLink[]` |
| `blame_line` | `{ repoPath, file, line }` | `BlameReport` |

```ts
interface CommitLink {
  id: string; taskId: string; sessionId?: string; repoPath: string;
  commitHash: string; subject?: string; author?: string;
  committedAt?: string; createdAt: string;
}
interface BlameReport {
  file: string; line: number;
  commitHash?: string; commitSubject?: string; commitAuthor?: string;
  linked: boolean;                 // 是否追到 AEL 任务
  task?: Task;                     // 哪次任务
  sessions: AgentSessionSummary[]; // 哪个 Agent / 模型
  decisions: TaskEvent[];          // 基于哪些 decision
  humanConfirmations: TaskEvent[]; // 人工确认记录(actor='human')
  guardEvents: TaskEvent[];        // Guard 修正记录(actor='guard')
  adrs: AdrRecord[];               // 关联 ADR
}
interface AgentSessionSummary {
  id: string; agentId: string; commandLine: string;
  startedAt: string; endedAt?: string; exitCode?: number;
}
```

## 出口 ④ · 活文档(ADR)

| 命令 | 入参 | 出参 |
|---|---|---|
| `compile_adrs` | `{ taskId, writeFiles? }` | `AdrRecord[]`(decision 事件→ADR;writeFiles 时落 repo `docs/adr/` + 更新 CLAUDE.md AEL 区块) |
| `list_adrs` | `{ taskId? }` | `AdrRecord[]` |

```ts
interface AdrRecord {
  id: string; taskId?: string; number: number; title: string;
  status: 'proposed' | 'accepted' | 'superseded';
  context: string; decision: string; consequences?: string;
  sourceEventId?: string; filePath?: string; createdAt: string;
}
```

## 横向机制:保鲜期 + 智能路由

| 命令 | 入参 | 出参 |
|---|---|---|
| `recheck_skill_freshness` | `{}` | `{ checked, downgraded, revived }`(对照当前 Agent 版本批量重估) |
| `recommend_agent` | `{ goal, tags? }` | `AgentRecommendation[]`(按本地成败账本排序) |

```ts
interface AgentRecommendation {
  agentKind: string; score: number;
  successCount: number; failCount: number; taskCount: number;
  reasons: string[];
}
```

## finalize(v2 语义升级)

`finalize_task` 现在是**编译器**:同一条证据链一次编译出三种产物。返回值扩展:

```ts
interface FinalizeResult {
  task: Task;
  draftSkills: Skill[];
  draftFailures: Failure[];
  brief: ReviewBrief;        // v2 新增:一页审阅证据
  adrs: AdrRecord[];         // v2 新增:decision → ADR(仅入库,不写文件;写文件用 compile_adrs)
}
```

## 配套二进制(非 IPC,同一数据层)

- `ael-cli`:`brief <taskId>` / `trailer <taskId>` / `blame <repo> <file> <line>` /
  `policy-check "<command>"`(exit 0 放行 / 2 拦截,可接 Claude Code PreToolUse hook)/
  `link-commit <taskId> <repo> [hash]` / `scan-commits <taskId> <repo>` / `install-hook <repo> <taskId>`
- `ael-mcp`:MCP stdio server,工具:`query_skills` / `check_failures` / `record_decision` / `export_handover`
  (经验层的 MCP 双形态 —— 原生 CLI 在会话内直接调用 AEL 记忆)
