# Tauri IPC 命令签名 · FROZEN v1

前端(Antigravity)↔ 后端(Claude Code)之间的契约。**已冻结。** 改动须先改本文件并通知前后端两侧。

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
