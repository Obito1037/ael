# AEL3 · AI 编码治理层

新增 **记忆学习与复用交互演示**：从侧栏“体验记忆复用”进入，或访问浏览器预览的 `/#demo`。演示包含候选审核、相关性判断、环境重验与反馈，不调用模型或修改真实记忆。操作说明与最新验证见 [记忆演示说明](docs/MEMORY-DEMO.md)。

前端已集成 OpenUI 的记忆证据渲染与 Open Claude UI 的本地控件，包含响应式导航、受控多行输入、历史后台扫描与分页。依赖来源、运行方式和稳定性边界见 [前端集成说明](docs/UI-INTEGRATION.md)，本轮检查及安装包信息见 [验证记录](docs/UI-VERIFICATION.md)。

> 本地优先的 AI 编码治理层:**黑匣子**(证据溯源)+ **海关**(运行时网关)+ **账本**(经验与责任资产)。
> 让 AI 写的每一行代码 **可信 · 可控 · 可追责 · 可理解**。

AEL3 是一个 Tauri 2 桌面应用。1.0 的经验层内核(PTY 执行 → 证据链 → finalize → 经验库 → 约束注入)原样保留,
2.0 在同一个内核上长出四个行业级出口:

| 出口 | 能力 | 一句话 |
|---|---|---|
| ① Review Brief | 审得过来 | 千行 diff → 一页证据(目标 / 决策 / 已拦截错误 / 验证 / 风险) |
| ② Agent Blame | 追得到责 | 任意一行 AI 代码 → 3 秒回放决策现场(commit trailer + 行级锚点) |
| ③ 运行时海关 | 管得住手 | PTY 坐在 Agent 与 Shell 之间,危险命令扣在裁决线上人工放行 / 拦截 |
| ④ 活文档 ADR | 读得懂 Why | decision 事件自动编译成架构决策记录 |

横向机制:经验保鲜期(模型换代自动降级待重验)、经验驱动智能路由、AHP 接手包开放标准。

新增 **Agent 集成页**：展示 Codex / Claude Code / Gemini 的运行状态、固定目标配置文件与外部工具入口。Provider/MCP 不是 AEL 的主流程；配置兼容层保存默认先备份，再通过同目录临时文件原子替换。Windows 安全替换实现沿用 MIT 许可组件的必要版权声明见本文末尾。AEL 仍把“高效复用正确记忆、可逆遗忘错误与无关信息”作为主线。

## AEL3 开源融合说明

AEL3 以复用成熟协议、适配器和打包机制为主，项目引用与融合边界集中记录在本 README；业务治理、证据账本、候选质量门和人工确认由 AEL3 自己负责。当前参考来源包括：

- [Agent Client Protocol Rust SDK](https://github.com/agentclientprotocol/rust-sdk)：结构化 Agent 会话、消息/思考/工具更新和停止原因。
- [codex-acp](https://github.com/agentclientprotocol/codex-acp)：Codex 的 ACP stdio 适配器，支持 ChatGPT 登录、API Key 和自定义网关认证路径。
- [claude-agent-acp](https://github.com/agentclientprotocol/claude-agent-acp)：Claude Agent 的 ACP 适配器。
- [sessions](https://github.com/sessions-so)：跨 Agent 会话历史的来源归一化思路。
- [skill-miner](https://github.com/GBSOSS/skill-miner)：经验候选提炼与质量门的设计参考。
- [vercel-labs/skills](https://github.com/vercel-labs/skills)：`SKILL.md` 技能资产的目录和分发形式。
- [handover](https://github.com/steveyegge/handover)：可审阅交接包的组织方式。
- [cross-agent-memory](https://github.com/mario-andresy/cross-agent-memory)：跨 Agent 记忆与来源链的建模参考。

这些项目只提供可复用的协议、适配和资产组织思路；AEL3 不把外部历史直接提升为 active 规则，所有候选必须保留来源并经过质量门和人工确认。

### 复用与许可证声明

Agent 配置层的 Windows 安全原子替换部分改编自 MIT 许可项目 `farion1231/cc-switch`（commit `273c9cc24fd091f8aa2f49d6d683d6c1a736e430`）。必要版权与许可文本如下：

Copyright (c) 2025 Jason Young

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.

## 软件工程课程报告

课程项目文档按“文档即代码”存放在 [`docs/report/`](docs/report/)：

1. [选题与 NABCD](docs/report/01-选题与NABCD.md)
2. [需求分析](docs/report/02-需求分析.md)
3. [原型与概要设计](docs/report/03-原型与概要设计.md)
4. [详细设计](docs/report/04-详细设计.md)
5. [实现与代码对照](docs/report/05-实现与代码对照.md)
6. [测试计划与用例](docs/report/06-测试计划与用例.md)
7. [测试报告](docs/report/07-测试报告.md)
8. [用户反馈](docs/report/08-用户反馈.md)

操作手册见 [`docs/AEL-使用说明.md`](docs/AEL-使用说明.md)。

## 架构

```
前端(React 19 + Tailwind + xterm) ── Tauri IPC ──> 后端(Rust)
  暖纸画布 + 克制珊瑚橙                              ├─ agent/   ACP 主运行时 + PTY fallback + 配置入口
  五个入口:工作台/记忆/证据/集成/设置                ├─ engine/  policy·redact·brief·adr·blame·route·freshness
  (安全作为工作台的全局浮层)                          │           + guard·finalize·search·normalize(1.0)
                                                     ├─ db/      SQLite(schema v6 + history/candidates)
                                                     └─ handover/ AHP/2.0 接手包（兼容旧包）
```

- 运行时海关策略在 `~/.ael/policy.toml`(首次启动物化,删除后重启恢复默认)。
- 默认数据目录为 `~/.ael/`，包含 `ael.db` / `backups/` / `briefs/` / `handovers/` / `skills/` / `settings.json` / `policy.toml`；设置页的 `dataDir` 会在下次启动时被实际采用，旧目录不会被自动删除。

## 开发

```bash
pnpm install
pnpm tauri dev
```

浏览器预览(不启动 Tauri,走内置 mock 数据):

```bash
pnpm dev   # 打开 http://localhost:1420
```

## 使用说明

面向使用者的安装、首个任务、Agent 运行、记忆沉淀、交接和故障排查步骤见 [`docs/AEL-使用说明.md`](docs/AEL-使用说明.md)。

Codex / Claude Code 会在 `runtime=auto` 时优先尝试 ACP 结构化会话；需要 Node.js 的 `npx`。ACP 不可用时自动回退到原有 PTY，会话输入按回车提交，运行中的停止信号会优先中断读取并记录终态。

Codex 的 ACP 会话以 `read-only` 模式启动，写操作和不能证明只读的命令都要先申请权限，由海关按 `policy.toml` 裁决：未命中放行并留痕，`hold` 等人工，`deny` 直接拒绝，写到工作区之外一律等人工。模型在「设置 → Codex 模型」配置，默认 `gpt-5.6-luna`，留空则沿用 Codex 自己的配置。

海关的边界：PTY 模式只能裁决从 AEL 输入的内容，Agent 在自身内部执行的命令要靠它自己的审批；Claude Code 和 Gemini 的 ACP 权限流程尚未用真实 Agent 验证。

真实流程验证：`node scripts/verify-core-flow.mjs` 用 PowerShell 走完海关、收尾、Brief、ADR、Blame，不消耗模型额度；`node scripts/verify-real-agent.mjs codex 170` 驱动真实 Codex，会消耗额度。首次使用 ACP 仍需按对应 Agent 的登录流程完成本机认证，不要求 AEL3 保存 API Key。

历史扫描入口在“记忆 → 历史扫描”：扫描只读本机历史并归一化为 Conversation/Turn/Message，候选提炼不会直接启用长期记忆；须经过质量门和人工审阅后，Skill 才会进入 draft，Failure 才会进入失败库。

## 构建

```bash
pnpm tauri build          # release;安装包在 src-tauri/target/release/bundle/{msi,nsis}
pnpm tauri build --debug  # debug
```

## 验证

```bash
pnpm typecheck
pnpm build

cd src-tauri
# Windows 上整包 cargo test 会连带编译 GUI bin(webview2/内存压力);按目标逐个跑:
cargo test --lib
cargo test --test db_tests -j 2
cargo test --test governance_tests -j 2
# 其余:adapter_tests / e2e_tests / handover_tests / scenarios_tests /
#       agent_runtime_tests / agent_config_tests / agent_context_tests
```

## 契约

- `design/REWRITE-2.0.md`:2.0 重写总规格(实现事实来源)
- `contracts/schema.sql`:SQLite schema v4 基线;v5、v6 见 `contracts/migrations/`,当前版本为 v6
- `contracts/policy-default.toml`:海关默认策略
- `src-tauri/src/models.rs`:领域模型 v2(与前端 `src/types.ts` 逐字段对齐)
