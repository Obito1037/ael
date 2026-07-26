# Agent Runtime IPC v1.1

This file is an additive contract for the multi-agent execution layer. It does
not change `contracts/ipc-commands.md` frozen v1.

## Purpose

AEL is now responsible for more than task memory. It can:

1. Detect local CLI agents: Codex, Claude Code, Gemini, OpenCode, and shell.
2. Start interactive agents through a PTY.
3. Stream terminal input/output to the frontend.
4. Persist transcripts.
5. Parse completed output lines into `task_events`.
6. Coordinate write access with workspace locks.
7. Build launch context from task evidence, Failure Guard, skills, handover,
   and repo metadata.
8. Read/write fixed agent config and project context files.

## Types

```ts
type AgentSessionStatus =
  | 'starting' | 'running' | 'waiting' | 'blocked'
  | 'exited' | 'killed' | 'failed';

type TerminalDirection = 'input' | 'output' | 'system';
type WorkspaceLockKind = 'read' | 'write';

interface AgentProfile {
  id: string;              // codex / claude_code / gemini / opencode / shell
  kind: string;            // adapter agent id
  displayName: string;
  executable: string;
  defaultArgs: string[];
  available: boolean;
  version?: string;
  path?: string;
}

interface AgentSession {
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

interface TerminalChunk {
  sessionId: string;
  seq: number;
  direction: TerminalDirection;
  text: string;
  createdAt: string;
}

interface AgentSnapshot {
  session: AgentSession;
  chunks: TerminalChunk[];
}

interface WorkspaceLock {
  id: string;
  repoPath: string;
  ownerSessionId: string;
  lockKind: WorkspaceLockKind;
  createdAt: string;
}

interface AgentStartupContext {
  task: Task;
  agentKind?: string;
  profileId?: string;
  recentEvents: TaskEvent[];
  matchedFailures: Failure[];
  suggestedSkills: Skill[];
  constraints: string[];
  handoverExcerpt?: string;
  manualNote?: string;
  tokensEst: number;
  parts: AgentStartupContextPart[];
  prompt: string;
}

interface AgentStartupContextPart {
  key: string;
  title: string;
  included: boolean;
  tokensEst: number;
}

type AgentConfigTargetType = 'native_config' | 'project_context';
type AgentConfigFormat = 'json' | 'toml' | 'markdown';

interface AgentConfigTarget {
  id: string;
  agentId: string;
  targetType: AgentConfigTargetType;
  format: AgentConfigFormat;
  path: string;
  exists: boolean;
  description: string;
}

interface AgentConfigContent {
  target: AgentConfigTarget;
  content: string;
}

interface AgentConfigWriteResult {
  target: AgentConfigTarget;
  backupPath?: string | null;
  bytesWritten: number;
}
```

## Commands

| Command | Args | Returns |
|---|---|---|
| `detect_agents` | `{}` | `AgentProfile[]` |
| `build_agent_startup_context` | `{ taskId, agentKind?, profileId?, manualNote?, eventLimit?, skillLimit?, includeGuard?, includeSkills?, includeHandover?, tokenBudget? }` | `AgentStartupContext` |
| `build_launch_context` | same as `build_agent_startup_context` | `AgentStartupContext` |
| `start_agent_session` | `{ taskId, profileId, cwd?, args?, initialPrompt?, executable?, rows?, cols?, autoIngest?, lockWorkspace? }` | `AgentSession` |
| `send_agent_input` | `{ sessionId, text }` | `void` |
| `resize_agent_terminal` | `{ sessionId, cols, rows }` | `void` |
| `stop_agent_session` | `{ sessionId, killTree? }` | `AgentSession` |
| `list_agent_sessions` | `{ taskId?, status? }` | `AgentSession[]` |
| `get_agent_snapshot` | `{ sessionId }` | `AgentSnapshot` |
| `list_terminal_chunks` | `{ sessionId, afterSeq? }` | `TerminalChunk[]` |
| `list_workspace_locks` | `{}` | `WorkspaceLock[]` |
| `release_workspace_locks_for_session` | `{ sessionId }` | `number` |
| `list_agent_config_targets` | `{ cwd? }` | `AgentConfigTarget[]` |
| `read_agent_config_target` | `{ targetId, cwd? }` | `AgentConfigContent` |
| `write_agent_config_target` | `{ targetId, cwd?, content, createBackup? }` | `AgentConfigWriteResult` |
| `backup_agent_config_target` | `{ targetId, cwd? }` | `string \| null` |

## Frontend Events

| Event | Payload |
|---|---|
| `agent://terminal-chunk` | `{ sessionId, chunk: TerminalChunk }` |
| `agent://session-status` | `{ sessionId, session: AgentSession }` |
| `agent://parsed-event` | `{ sessionId, event: TaskEvent }` |

## Config Targets

The config sync surface is fixed-target only. The frontend cannot submit
arbitrary paths.

| Target id | Agent | Type | Format | Path |
|---|---|---|---|---|
| `codex_global` | `codex` | `native_config` | `toml` | `~/.codex/config.toml` |
| `codex_project` | `codex` | `project_context` | `markdown` | `<cwd>/AGENTS.md` |
| `claude_global` | `claude_code` | `native_config` | `json` | `~/.claude/settings.json` |
| `claude_legacy_global` | `claude_code` | `native_config` | `json` | `~/.claude.json` |
| `claude_project` | `claude_code` | `project_context` | `markdown` | `<cwd>/CLAUDE.md` |
| `gemini_global` | `gemini` | `native_config` | `json` | `~/.gemini/settings.json` |
| `gemini_project` | `gemini` | `project_context` | `markdown` | `<cwd>/GEMINI.md` |
| `opencode_global` | `opencode` | `native_config` | `json` | `%APPDATA%/opencode/config.json` on Windows, else `~/.config/opencode/config.json` |
| `opencode_project` | `opencode` | `project_context` | `markdown` | `<cwd>/AGENTS.md` |

Writes are UTF-8 only and capped at 2 MiB. `write_agent_config_target`
defaults `createBackup` to `true`; missing files simply produce
`backupPath: null`.

## Startup Context Injection

Before launching an agent, the frontend should call
`build_agent_startup_context` and preview/use the returned `prompt` as
`start_agent_session.initialPrompt`.

The backend-owned context includes:

1. Current task goal, tags, repo path, branch, and commit.
2. Recent task evidence from `task_events`.
3. `check_failure_guard(goal, tags).constraints`.
4. Matched failures and top active skills.
5. A handover/progress excerpt when `includeHandover !== false`.
6. User launch notes from `manualNote`.

The prompt shape follows
`D:\desktop\ael-starter-kit\ael-starter-kit\design\launch-prompt-template.md`:
task, hard constraints, pitfalls, skills, repo/worktree alignment, handover
progress, and working discipline. `tokensEst` is an approximate character-based
estimate; `tokenBudget` triggers a compact render that keeps task, hard
constraints, and repo alignment.

The backend writes `initialPrompt` into the PTY. Later terminal output is
persisted as `terminal_chunks` and parsed into `task_events` when `autoIngest`
is true.

## Workspace Lock Rules

`lockWorkspace=true` is the default for `start_agent_session`.

- Starting a session acquires a write lock for its canonical `cwd`.
- A second write lock on the same `cwd` returns `AelError { code: "conflict" }`.
- Locks are released when a session becomes `exited`, `killed`, or `failed`.
- On app restart, stale running sessions are marked `failed` and their locks are released.

## Persistence

Agent Runtime v1.1 uses schema v2 tables:

- `agent_profiles`
- `agent_sessions`
- `terminal_chunks`
- `workspace_locks`

Config sync writes to real config/context files and stores backups under
`<ael-data-dir>/backups/config/`.

---

## Provider / MCP 配置命令(migration v3,2026-06 补)

CC Switch 等价层。前端 `src/lib/ipc.ts` 调用,后端 `commands/provider.rs` 实现,数据存 `providers` / `mcp_servers`(见 migrations/003)。

| 命令 | 入参 | 出参 |
|---|---|---|
| `list_providers` | `{}` | `ProviderConfig[]` |
| `save_provider` | `{ provider: ProviderConfig }` | `void`(upsert;`apiKey` 传空则保留旧值)|
| `test_provider` | `{ providerId }` | `{ success: bool, message }`(GET `{endpoint}/v1/models`)|
| `list_mcp_servers` | `{}` | `MCPServerConfig[]` |
| `save_mcp_server` | `{ server: MCPServerConfig }` | `void`(upsert)|

`ProviderConfig = { id, name, targetApp:'claude'|'codex'|'gemini'|'universal', model, endpoint, apiKey, isActive, notes? }`
`MCPServerConfig = { id, name, command, args[], env{}, isActive }`

说明:`apiKey` 存本机 SQLite,`list_providers` 会原样回传(与前端 round-trip 一致);保存时若 `apiKey` 为空字符串则不覆盖已存密钥。`test_provider` 需要 HTTP 客户端(`ureq`)。
