# AEL

AEL is a Tauri 2 desktop control plane for multi-agent work.

It combines:

- task and evidence tracking
- reusable Skill extraction
- Failure Guard constraints
- handover.zip export/import
- Agent Runtime for launching Codex, Claude Code, Gemini, OpenCode, or a shell through PTY

## Development

```bash
pnpm install
pnpm tauri dev
```

## Build

Debug build:

```bash
pnpm tauri build --debug
```

Release build:

```bash
pnpm tauri build
```

Windows installers are generated under:

```text
src-tauri/target/release/bundle/msi
src-tauri/target/release/bundle/nsis
```

## Verification

```bash
pnpm typecheck
pnpm build
pnpm exec playwright test
python contracts/validate_schema.py
python src-tauri/verify_e2e.py
python src-tauri/verify_scenarios.py
cd src-tauri
cargo test
```

## Important Contracts

- `contracts/ipc-commands.md`: frozen task/skill/failure/handover IPC v1
- `contracts/agent-commands.md`: Agent Runtime IPC v1
- `contracts/schema.sql`: SQLite schema v1
- `contracts/INTEGRATION-POINTS.md`: external API / CC Switch / MCP integration notes
