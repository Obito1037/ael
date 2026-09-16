# AEL 2.0 · AI 编码治理层

> 本地优先的 AI 编码治理层:**黑匣子**(证据溯源)+ **海关**(运行时网关)+ **账本**(经验与责任资产)。
> 让 AI 写的每一行代码 **可信 · 可控 · 可追责 · 可理解**。

AEL 是一个 Tauri 2 桌面应用。1.0 的经验层内核(PTY 执行 → 证据链 → finalize → 经验库 → 约束注入)原样保留,
2.0 在同一个内核上长出四个行业级出口:

| 出口 | 能力 | 一句话 |
|---|---|---|
| ① Review Brief | 审得过来 | 千行 diff → 一页证据(目标 / 决策 / 已拦截错误 / 验证 / 风险) |
| ② Agent Blame | 追得到责 | 任意一行 AI 代码 → 3 秒回放决策现场(commit trailer + 行级锚点) |
| ③ 运行时海关 | 管得住手 | PTY 坐在 Agent 与 Shell 之间,危险命令扣在裁决线上人工放行 / 拦截 |
| ④ 活文档 ADR | 读得懂 Why | decision 事件自动编译成架构决策记录 |

横向机制:经验保鲜期(模型换代自动降级待重验)、经验驱动智能路由、AHP 接手包开放标准。

新增 **Agent 中心**：统一管理 Codex / Claude Code / Gemini 的 Provider、固定目标配置文件与 MCP Server。配置文件保存默认先备份，再通过同目录临时文件原子替换；Windows 覆盖逻辑改编自 MIT 许可的 [CC Switch](https://github.com/farion1231/cc-switch)，完整声明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。AEL 仍把“高效复用正确记忆、可逆遗忘错误与无关信息”作为主线，Agent 配置只是可替换的连接层。

## 架构

```
前端(React 19 + Tailwind + xterm) ── Tauri IPC ──> 后端(Rust)
  暖纸画布 + 克制珊瑚橙                              ├─ agent/   PTY 运行时 + 海关接线 + 固定目标配置
  十个视图:新任务/工作台/记忆/Agent 中心/任务/      ├─ engine/  policy·redact·brief·adr·blame·route·freshness
  海关/Brief/溯源/ADR/设置                            │           + guard·finalize·search·normalize(1.0)
                                                     ├─ db/      SQLite(schema v4)
                                                     └─ handover/ AHP v1 接手包
```

- 运行时海关策略在 `~/.ael/policy.toml`(首次启动物化,删除后重启恢复默认)。
- 数据目录 `~/.ael/`:`ael.db` / `backups/` / `briefs/` / `handovers/` / `skills/` / `settings.json` / `policy.toml`。

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
- `contracts/schema.sql`:SQLite schema v4(治理层基线,已冻结)
- `contracts/policy-default.toml`:海关默认策略
- `src-tauri/src/models.rs`:领域模型 v2(与前端 `src/types.ts` 逐字段对齐)
