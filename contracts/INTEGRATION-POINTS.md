# Integration Points

This document records the stable integration shape for AEL. Frozen contracts
still live in their own files; new surfaces must be additive unless the matching
contract version is bumped first.

## Stable Query Surface

These commands are the shared read/query layer for UI, future API, MCP tools,
and external panels:

| Command | Purpose | Status |
|---|---|---|
| `search_skills` | Retrieve reusable skills, with score in the IPC response. | v1 |
| `check_failure_guard` | Return known failure matches and startup constraints. | v1 |
| `generate_handover_prompt` | Generate a self-contained handover prompt. | v1 |
| `get_skill` / `list_skills` | Read skills. | v1 |
| `get_task` / `list_tasks` / `list_events` | Read tasks and evidence chains. | v1 |
| `list_failures` / `get_failure` | Browse known failures. | v1 |

Trusted local UI may also use write commands such as `create_task`,
`append_event`, `finalize_task`, `update_*`, `record_skill_usage`,
`export_handover`, and `import_handover`.

## Agent Runtime

Implemented in `contracts/agent-commands.md`.

AEL now provides a CC Switch-like execution layer:

- Detect local Codex, Claude Code, Gemini, OpenCode, and shell CLIs.
- Build backend-owned startup context from task evidence, Failure Guard, and
  active skills.
- Start interactive PTY sessions.
- Stream terminal transcript through Tauri events.
- Persist sessions in `agent_sessions` and transcript chunks in `terminal_chunks`.
- Parse output into existing `task_events`.
- Acquire/release `workspace_locks` to avoid two agents writing the same repo.
- Read/write fixed agent config and project context files.

This does not replace CC Switch provider management. It gives AEL its own
execution kernel and a stable shape that CC Switch-like panels can map onto.

## External API

Reserved, not implemented.

When added, the API should mirror IPC request/response JSON:

- camelCase arguments.
- same return structs as IPC.
- errors shaped as `AelError { code, message }`.
- a transport-level `apiVersion`, starting at `"1"`.

Suggested module path: `src-tauri/src/api/`, reusing `commands/` handlers where
possible so command behavior stays single-source.

## MCP Server

Reserved, not implemented.

Tool namespace: `ael.*`.

Initial read-only tools should map directly to stable commands:

| MCP Tool | IPC Command |
|---|---|
| `ael.search_skills` | `search_skills` |
| `ael.check_failure_guard` | `check_failure_guard` |
| `ael.generate_handover_prompt` | `generate_handover_prompt` |
| `ael.build_agent_startup_context` / `ael.build_launch_context` | matching Agent Runtime IPC commands |
| `ael.get_skill` / `ael.list_skills` | matching IPC commands |
| `ael.get_task` / `ael.list_tasks` / `ael.list_events` | matching IPC commands |

Write tools should be behind an explicit local-trust switch.

## CC Switch / External Panel Mapping

An external panel can either embed AEL UI or call the same IPC/API layer:

- Use task/skill/failure queries for dashboards.
- Use Agent Runtime commands for session launch and terminal attach.
- Use config sync commands for Codex/Claude/Gemini/OpenCode settings screens.
- Use `Task.agentId` to record provenance such as `cc_switch`, `codex`, or
  `claude_code`.
- Use `Settings.dataDir` if a future panel needs profile-level data isolation.

## handover.zip

`handover-schema.json` v1 is self-contained and versioned. External consumers
can read it without needing oral context.

If future integration metadata is needed, add it only through a versioned schema
change. Current top-level schema is closed by design.

## Change Rules

1. Do not silently mutate frozen contracts.
2. For breaking changes, update the relevant file under `contracts/`, bump its
   version, then update UI/backend/API/MCP consumers together.
3. Reserve command namespaces here before two tools implement different meanings
   under the same name.
