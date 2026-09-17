# AEL 前端重塑 v2 · Codex 式会话主界面(前后端修改)

> 取代上一版"中心 composer"方案。按你的反馈定稿:**整体采用 Codex/Claude Code 那种"会话为中心"的主界面**,
> 左栏只留会话历史/项目;Skills、Provider/MCP、失败模式"库"全部收进**设置**;失败提醒**内联进对话页**;
> 删掉各标题下的说明小字。并补齐三个真缺的能力(需后端新命令):**看 CLI 原生历史上下文、压缩上下文、token 按真实 I/O 估算**。
> 已充分对照当前 `ael` 真实代码(组件/IPC/事件/schema)。

---

## 0. 先回答你的几个问题(基于当前后端真实能力)

| 你的问题 | 现状 | 结论 |
|---|---|---|
| 改完支持历史对话? | 后端已持久化 transcript:`list_agent_sessions` + `list_terminal_chunks` + `get_agent_snapshot` | **支持**。前端缺"会话历史列表 + 重新打开看全程"的 UI,本次补。 |
| 能同时看多个 agent 输出? | 后端已支持并发会话,事件 `agent://*` 都带 `sessionId` | **后端支持**。前端缺"多窗格/标签同时看"的布局,本次补。 |
| 导出接手包正确吗?怎么用? | `export_handover` 产 zip(manifest+handover_prompt.md+evidence/),`generate_handover_prompt` 自给自足,均已测 | **正确**。用法:对话页顶部「导出接手包」,按会话所属 task 导出。 |
| Skills/Provider 要不要单列? | — | **不单列**,移进**设置**(库与配置都在设置里);Skill 仍在启动时自动注入。 |
| 失败模式单列? | — | **不单列**;作为**对话页内联提醒**(命中即横幅),库管理移进设置。 |
| 标题下小字介绍? | 如"以下坑会在相似任务开始时自动提醒…" | **全删**,向 Codex 看齐:只留标题与内容。 |
| 看 codex/claude 历史上下文对话? | **后端没有** | 需新增"读 CLI 原生会话文件"命令(§4-C)。 |
| 生成接手包 / 压缩上下文 入口? | 接手包后端有;**压缩上下文后端没有** | 接手包补 UI 入口;压缩需新增 `compress_context`(§4-B)。 |
| token 估算方式? | 现在前端按终端字符自测 | 改为**后端按真实输入/输出 transcript 估算**(§4-A),前端只展示。 |

---

## 1. 目标版式:Codex 式三区

```
┌───────────────┬──────────────────────────────────────────────┬───────────────┐
│  ＋ 新建会话   │  📁 my-repo ⌄   🤖 Claude Code ⌄   🌿 main ⌄   ⤓接手包  ⚙  │
│               │ ┌──────────────────────────────────────────┐  │ 上下文/Token │
│  会话历史      │ │ [Claude#1] [Codex#2] [+]   ← 多 agent 标签  │  │ 12.3k / 200k │
│   · #3 my-repo│ │                                            │  │ [压缩 ⌄]     │
│   · #2 svc-api│ │   终端 / 对话流(xterm,实时)              │  │              │
│   · #1 …      │ │                                            │  │ 证据流        │
│               │ │                                            │  │ [step] …     │
│  Projects ▾   │ │                                            │  │ [error]…[入库]│
│   📁 my-repo  │ │  ⚠ 命中历史失败:link.exe… → 约束:装 VS… │  │              │
│   📁 svc-api  │ └──────────────────────────────────────────┘  │ 锁:my-repo🔒 │
│               │  ＋  ⎇ Local ⌄        发送…            ▶/■     │              │
└───────────────┴──────────────────────────────────────────────┴───────────────┘
        左栏(只留会话/项目)            中区(会话页=主角)            右栏(监控,可收起)
```

- **左栏**:`＋ 新建会话` → `会话历史`(主列表,按工作区分组)→ `Projects`(工作区树)。**没有** Skills / 失败模式 / 配置这些项(都进设置 ⚙)。
- **中区(主角)**:会话页。顶部一行 = 工作区 + Agent/Provider + 分支 + 接手包 + 设置;**多 agent 标签栏**(并行会话用标签切/可分屏);终端流;**失败提醒内联横幅**;底部输入 + Local/worktree + 启动/停止。
- **右栏(监控,可收起)**:真实 token 用量 + 压缩按钮;实时证据流(parsed-event,点「入库」);工作区锁状态。
- **设置 ⚙**(右上角进):Tab = Providers / MCP / Skills 库 / 失败模式库 / 数据与备份。

---

## 2. 前端改动(对照现有组件)

| 现有组件 | 处置 | 说明 |
|---|---|---|
| `Sidebar.tsx` | **改写** | 只留:新建会话 / 会话历史(分组列表)/ Projects。删掉 skills/failures/configs 入口。 |
| `App.tsx` | **改状态机** | 主区:`session`(默认)/ `task`/ `settings`。无独立 skills/failures/configs 顶层路由。 |
| `AgentsConsole.tsx` | **重构为会话页** | ① 顶部条(工作区+Agent+分支+接手包);② **多会话标签栏**(并行);③ 终端;④ **失败内联横幅**(`check_failure_guard` 结果);⑤ 右栏监控(token 来自后端、压缩按钮、证据流、锁)。启动表单收进顶部条的下拉,不再占整页。 |
| `FailureDefense.tsx` | **拆**:库部分→设置;**提醒部分→会话页内联** | 删除标题下说明小字。 |
| `SkillsLibrary.tsx` | **移进设置** Tab | 删除装饰性小字。 |
| `AgentConfigs.tsx` | **移进设置** Tab(Providers/MCP/Raw) | 已接通后端 5 命令,直接放设置里。 |
| `SettingsView.tsx` | **扩为设置容器** | 内含 Tab:Providers / MCP / Skills / Failures / 数据与备份。 |
| `TaskDetail.tsx` | 留 | 从会话/项目进入;证据链时间线。 |
| `TaskList.tsx` | 并入左栏 Projects / 会话历史 | 不单独成页。 |
| `HandoverModal.tsx` | 留 | 由会话页顶部「接手包」触发。 |
| `Header.tsx` | 简化/并入中区顶部条 | Codex 无独立大顶栏。 |
| `Toast.tsx`/`store`/`lib/ipc.ts`/`types.ts` | 留,按 §4 加新类型/封装 | |

**多 agent 同时输出(前端)**:会话页用**标签栏**承载多个活动 `sessionId`;每个标签一个 xterm 实例,各自订阅 `agent://terminal-chunk` 并按 `payload.sessionId` 分发。支持"分屏"把 2 个标签并排,满足"同时看多个 agent 输出"。后端无需改(本就并发 + 带 sessionId)。

**会话历史(前端)**:左栏列表来自 `list_agent_sessions()`;点击 → `get_agent_snapshot(sessionId)` 拉回 session + 全量 chunks,在终端里回放(只读)。退出的会话显示终态 + 「以此为基础新建」。

**失败内联(前端)**:进入/新建会话时调 `check_failure_guard(goal, tags)`,命中就在终端上方显示一条横幅(描述 → 约束),无命中不显示。**删掉**原"以下坑会自动提醒…"这类说明小字。

---

## 3. 接手包用法(已正确,只补入口)

会话页顶部「⤓ 接手包」:
1. 弹 `HandoverModal`,实时预览 `generate_handover_prompt(taskId)`(taskId = 当前会话的 `session.taskId`)。
2. 勾选包含项 → `export_handover({ taskId, include })` → 提示生成路径 `~/.ael/handovers/<taskId>.zip` + 「复制接手 Prompt」。
后端零改动(已测:zip 内含 manifest.json + handover_prompt.md + evidence/)。

---

## 4. 后端改动(新增 3 个能力 + 1 个可选)

> 均为**增量**,沿用 ael 约定(`#[tauri::command]` + `State<AppState>` + `AelResult` + serde camelCase),注册进 `lib.rs`。

### A. token 按真实 I/O 估算(替代前端自测)
新增命令,数据来自该会话已落库的 `terminal_chunks`(真实输入+输出),不再让前端瞎算:
```
get_session_token_usage(session_id) -> SessionTokenUsage {
  inputTokens, outputTokens, totalTokens,
  source: 'agent_reported' | 'transcript_estimate'
}
```
实现:`db.list_terminal_chunks` 按 `direction` 分组(input/output);先尝试**正则解析 agent 自己打印的用量行**(如 `tokens used: N` / `input=… output=…`)→ `source='agent_reported'`;解析不到则用启发式估算(英文≈chars/4,CJK 按字数)→ `transcript_estimate`。放 `src-tauri/src/agent/` 下新函数 + 注册命令。前端右栏只读展示。

### B. 压缩上下文(新功能)
```
compress_context(session_id?, text?, mode, token_budget?) -> {
  compressed, tokensBefore, tokensAfter
}
// mode: 'summary'(长输出摘要) | 'budget'(压到 token 预算) | 'handover'(压成接手注入)
```
MVP 用**规则/抽取式**:对 transcript 去噪、保留 error/decision/最近 N 段、按 budget 截断;`handover` 模式直接复用 `generate_handover_prompt` 的精炼段。可选:把摘要作为一条 `note` 事件写回任务证据链。放 `src-tauri/src/agent/context.rs` 旁新增 `compress.rs`。(后续可接本地小模型升级,签名不变。)

### C. 看 CLI 原生历史上下文对话(新功能,需核对文件格式)
让用户在 AEL 里直接翻 codex/claude 自己存的会话历史:
```
list_native_sessions(agent_kind) -> NativeSession[] { id, title?, path, updatedAt, messageCount? }
read_native_session(agent_kind, id) -> { messages: [{ role, content, at? }] }   // 解析失败则回退 rawText
```
落地点(需实现时核对真实格式):
- Claude Code:`~/.claude/projects/<工程哈希>/*.jsonl`(每行一条消息)。
- Codex:`~/.codex/sessions/*.jsonl`(rollout 记录)。
- Gemini/OpenCode:各自历史目录,后补。
放新模块 `src-tauri/src/agent/native_history.rs`;**只读**,不改用户文件。前端在"会话历史"里加一个「CLI 原生历史」分组,点开渲染。
> 这几个路径/格式我实现时会先核对官方文档再写,避免猜错。

### D.(可选)New Worktree
`create_worktree(repo_path, branch) -> { worktreePath }`(git worktree),配合并行多 agent + 锁。没就绪前 UI 只给 `Local`。

---

## 5. 复用的现有后端(不动)
`detect_agents` / `start_agent_session` / `send_agent_input` / `resize_agent_terminal` / `stop_agent_session` / `list_agent_sessions` / `get_agent_snapshot` / `list_terminal_chunks` / `list_workspace_locks` / `release_workspace_locks_for_session` / `build_agent_startup_context` / `check_failure_guard` / `export_handover` / `generate_handover_prompt` / `list_providers` / `save_provider` / `test_provider` / `list_mcp_servers` / `save_mcp_server` / `*_agent_config_target` / 任务与经验全套。事件:`agent://terminal-chunk|session-status|parsed-event`。

## 6. 前端要新增的 ipc.ts 封装 + 类型
- `getSessionTokenUsage(sessionId)` → `SessionTokenUsage`
- `compressContext(args)` → `{ compressed, tokensBefore, tokensAfter }`
- `listNativeSessions(agentKind)` / `readNativeSession(agentKind, id)`
- 对应 `types.ts` 增 `SessionTokenUsage` / `NativeSession` / `NativeMessage` / `CompressResult`。

---

## 7. 落地顺序(给 agy + 后端)
1. 后端先加 §4-A `get_session_token_usage`、§4-B `compress_context`(解锁右栏真实 token + 压缩按钮)。
2. 前端重写 `Sidebar`(只留会话/项目)+ `App` 状态机;`SettingsView` 扩成 Tab 容器,把 Skills/Failures/Providers/MCP 搬进去。
3. `AgentsConsole` 重构成会话页:多会话标签 + 失败内联横幅 + 右栏(后端 token + 压缩 + 证据流 + 锁)。
4. 会话历史列表(`list_agent_sessions` → `get_agent_snapshot` 回放)。
5. 后端 §4-C 原生历史(先核对格式)→ 前端"CLI 原生历史"分组。
6. 删除所有标题下说明小字;统一 token/留白/圆角(现有配色不动)。

**验收:**
- 主界面是 Codex 式会话页;左栏只有会话/项目;Skills/Provider/失败库都在设置里。
- 能开 ≥2 个 agent 会话并**同屏看各自输出**;能从会话历史**重新打开看完整上下文**;能看 codex/claude **原生历史会话**。
- 接手包能从会话页导出且内容正确;能对当前会话**压缩上下文**;右栏 **token 来自真实 I/O**(后端),非前端自测。
- 失败提醒**内联**在对话里;无多余说明小字。
- `pnpm exec tsc --noEmit && pnpm build` 零报错。
