# Provider / Profile 配置项清单(对照 CC Switch)

> 目的:AEL 要像 CC Switch 那样统一管理 Codex / Claude / Gemini 等 CLI 的"供应商配置",
> 才能在启动 agent 前把正确的 key / endpoint / 模型 / MCP 注入进去。
> 本文整理每个 CLI **写哪些文件、认哪些环境变量、MCP 配在哪**,作为 Config 模块与 `agent-commands.md` 的事实依据。
>
> 数据来源见文末。CC Switch 版本 v3.16(2026-05),覆盖 Claude Code / Claude Desktop / Codex / Gemini CLI / OpenCode / OpenClaw / Hermes。
> ⚠️ CLI 的字段与默认模型会随版本变,接入前以各自官方文档为准;AEL 应把"预设"做成可更新的数据,而非硬编码。

---

## 0. 概念对齐:CC Switch 的两层模型

- **Provider(供应商)**:一组"用谁家的服务"配置 —— name / API Key / endpoint(base_url)/ 模型 / API 格式。
- **App(目标 CLI)**:Claude Code / Codex / Gemini …。一个 Provider 可以是 **App 专属**,也可以是 **Universal**(同一份 key/endpoint 同步到多个 App)。
- **激活(switch)**:把某 Provider 写进该 App 的真实配置文件;CC Switch 用 SQLite + 原子写保存自己的副本,再"回填"到 CLI 的配置文件。
- AEL 对应:**Profile = Provider×App 的一次具体配置**;激活 = 把 Profile 落到 CLI 配置文件(或在 spawn 时用 env 覆盖,见下)。

CC Switch 关键能力(AEL 可分批对齐):预设(50+)、一键导入、Universal 同步、MCP 统一管理、托盘快速切换、代理/接管/故障转移、用量与配额展示、CLI 生命周期(装/更新/诊断)。
MVP 我们只需要前四项里的 **Provider 配置 + MCP + 激活/切换**。

---

## 1. Claude Code

| 项 | 位置 / 值 |
|---|---|
| 主配置 | `~/.claude/settings.json`(用户级);项目级 `.claude/settings.json` / `.claude/settings.local.json` |
| 切供应商关键字段 | `settings.json` 的 `env` 块:`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`(Bearer)或 `ANTHROPIC_API_KEY` |
| 模型 | `env.ANTHROPIC_MODEL`(及小模型 `ANTHROPIC_SMALL_FAST_MODEL`) |
| 也可用环境变量 | 同名进程环境变量优先于文件(适合 spawn 时用 env 覆盖,不动用户文件) |
| MCP 配置 | 用户级 `~/.claude.json`(按项目分组);项目级 `.mcp.json`;命令行 `claude mcp add ...` |
| 常用开关(CC Switch 暴露的) | `env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`、`ENABLE_TOOL_SEARCH`、`CLAUDE_CODE_EFFORT_LEVEL`、`DISABLE_AUTOUPDATER`;`attribution` 隐藏提交署名 |
| 热切换 | Claude Code 支持不重启热切换(CC Switch 特别说明);其余 CLI 需重开终端 |

最小 Provider 形状(Claude):
```json
{ "env": { "ANTHROPIC_API_KEY": "…", "ANTHROPIC_BASE_URL": "https://api.example.com", "ANTHROPIC_AUTH_TOKEN": "…(可选,二选一)" } }
```

## 2. Codex(OpenAI Codex CLI)

| 项 | 位置 / 值 |
|---|---|
| 鉴权 | `~/.codex/auth.json` → `{ "OPENAI_API_KEY": "…" }` |
| 主配置 | `~/.codex/config.toml`(用户级);项目级 `.codex/config.toml`(仅受信任项目) |
| 模型/供应商 | `model`、`model_provider`、`model_reasoning_effort`(low/medium/high)、`disable_response_storage` |
| 自定义供应商 | `[model_providers.<name>]`:`base_url`、`wire_api`(常为 `responses`)、`requires_openai_auth` |
| 1M 上下文(可选) | `model_context_window = 1000000` + `model_auto_compact_token_limit = 900000` |
| MCP 配置 | `config.toml` 内 `[mcp_servers.<name>]`:`command`(必填)、`args`、`env`;或命令行 `codex mcp` |
| 目录是否预建 | `~/.codex/` 默认不存在,需自行创建 |

最小 Provider 形状(Codex)= 两个文件:
```toml
# ~/.codex/config.toml
model_provider = "custom"
model = "gpt-5.2"
[model_providers.custom]
base_url = "https://api.example.com/v1"
wire_api = "responses"
requires_openai_auth = true
```
```json
// ~/.codex/auth.json
{ "OPENAI_API_KEY": "…" }
```

## 3. Gemini CLI

| 项 | 位置 / 值 |
|---|---|
| 主配置 | `~/.gemini/settings.json`(用户级);项目级 `.gemini/settings.json` |
| 切供应商关键字段 | `env` 块:`GEMINI_API_KEY`、`GOOGLE_GEMINI_BASE_URL`、`GEMINI_MODEL` |
| 鉴权类型 | `selectedAuthType`(如 `gemini-api-key` / Google OAuth);CC Switch 自动探测 |
| MCP 配置 | `settings.json` 顶层 `mcpServers` 对象(每个 server 一项);可用 `${VAR}` 引用环境变量 |

最小 Provider 形状(Gemini):
```json
{ "env": { "GEMINI_API_KEY": "…", "GOOGLE_GEMINI_BASE_URL": "https://api.example.com" } }
```

## 4. 通用 shell / 任意命令(AEL 的兜底适配器)

无供应商配置文件;Profile 退化为:`command` + `args` + `cwd` + `env`(键值对) + 可选 `shell`。
用于把任意 CLI 工具当一个 agent 拉起来(最通用的适配器,后续扩展新 agent 的样板)。

---

## 5. 三家横向对照(给 Config 模块建模用)

| 维度 | Claude Code | Codex | Gemini CLI | 通用 shell |
|---|---|---|---|---|
| 配置文件 | `~/.claude/settings.json` | `~/.codex/config.toml` + `auth.json` | `~/.gemini/settings.json` | 无 |
| Key 字段 | `ANTHROPIC_API_KEY`/`_AUTH_TOKEN` | `OPENAI_API_KEY`(auth.json) | `GEMINI_API_KEY` | 自定义 env |
| Endpoint 字段 | `ANTHROPIC_BASE_URL` | `[model_providers.*].base_url` | `GOOGLE_GEMINI_BASE_URL` | — |
| 模型字段 | `ANTHROPIC_MODEL` | `model` | `GEMINI_MODEL` | — |
| MCP 位置 | `~/.claude.json` / `.mcp.json` | `[mcp_servers.*]` in config.toml | `mcpServers` in settings.json | — |
| 注入方式 | 文件 `env` 或进程环境变量 | 文件(两份) | 文件 `env` 或进程环境变量 | 进程环境变量 |
| 热切换 | 支持 | 需重启 | 需重启 | N/A |
| 启动命令(典型) | `claude` | `codex` | `gemini` | 任意 |

---

## 6. 对 AEL 的设计结论(给 Config 模块 + spawn 层)

1. **激活有两条路,AEL 优先选"进程环境变量覆盖"**:spawn agent 时把该 Profile 的 key/endpoint/model 作为子进程 env 注入,**不改用户的 `~/.claude` 等文件**(隐私 + 不破坏用户既有配置,符合 NOTES.md 第 5 条本地优先)。仅当用户显式要求"写入 CLI 配置文件(像 CC Switch 那样持久切换)"时才回填文件,并先备份原文件(原子写)。
2. **Codex 是双文件**(auth.json + config.toml,且含 TOML 表),Config 模块的"激活/回填"要按 App 分别处理,不能假设所有 CLI 都是单 JSON。
3. **MCP 统一管理**:AEL 维护一份 MCP server 清单,激活 Profile 时按目标 App 的格式分别写入(Claude→`.claude.json`/`.mcp.json`、Codex→`[mcp_servers.*]`、Gemini→`mcpServers`)。MVP 可只读不写。
4. **预设可更新**:把 provider 预设(名称/endpoint/默认模型)做成数据(可后续拉取),不要硬编码到 Rust。
5. **密钥存储**:key 不进 `tasks`/日志;放系统凭据库或 `~/.ael` 下加权限的文件,导出/handover 默认脱敏(NOTES.md 第 5 条)。
6. **环境变量冲突**:用户 shell 里已有的 `ANTHROPIC_*`/`OPENAI_*` 会影响 CLI;spawn 前做一次冲突检测并提示(CC Switch 有专门的"环境变量冲突"页)。

---

## 来源
- [farion1231/cc-switch (GitHub)](https://github.com/farion1231/cc-switch)
- [CC Switch 用户手册 · 添加供应商](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/2-providers/2.1-add.md)
- [CC Switch 用户手册 · 总目录(含配置文件/MCP/会话章节)](https://github.com/farion1231/cc-switch/blob/main/docs/user-manual/en/README.md)
- [Codex 配置参考(config.toml)](https://developers.openai.com/codex/config-reference) · [Codex MCP](https://developers.openai.com/codex/mcp)
- [Claude Code settings 文档](https://code.claude.com/docs/en/settings)
- [Gemini CLI MCP / settings 文档](https://geminicli.com/docs/tools/mcp-server/)
