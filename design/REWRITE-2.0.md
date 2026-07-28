# AEL 2.0 重写总规格(实现契约)

> 本文档是 2.0 全量重写的**唯一事实来源**。所有实现必须与本文一致;
> 与旧代码冲突时,以本文为准。数据库契约见 `contracts/schema.sql`(v4,已冻结)。
> 领域模型见 `src-tauri/src/models.rs`(v2,已冻结,仅允许补字段不允许改语义)。

## 0. 定位(来自 AEL-2.0-创新升级方案)

AEL = 本地优先的 AI 编码治理层:**黑匣子**(证据溯源)+ **海关**(运行时网关)+ **账本**(经验与责任资产)。

- 1.0 内核全部保留:PTY 执行 → 证据链 → finalize → 经验库 → 约束注入。
- 2.0 四个出口:① Review Brief(审得过来)② Agent Blame(追得到责)③ 运行时海关(管得住手)④ 活文档 ADR(读得懂 Why)。
- 横向机制:经验保鲜期、智能路由、AHP 接手包 v2。

四条成功标准:同错不犯二次 / 换 Agent 不重讲上下文 / 千行 diff 审阅 ≤5 分钟 / 任意一行 3 秒到决策现场。

## 1. 后端模块布局(src-tauri/src)

```
lib.rs            模块声明 + Tauri 装配 + 全量 IPC 注册(v2 清单见 §4)
main.rs           不变
error.rs          不变(AelError)
models.rs         v2 已冻结(可补:Failure 增加 task_id/source_event_id/normalized_text/created_at/last_seen_at 序列化字段)
state.rs          AppState { db, settings(RwLock), agents: AgentRuntime, gate: PolicyGate }
util.rs           保留

db/               保留既有实现;确保 adr.rs / blame.rs / policy.rs 完整覆盖 schema v4
engine/
  mod.rs          re-export
  normalize.rs    保留(签名引擎)
  search.rs       保留(FTS + 评分)
  guard.rs        保留(事前 · pre-mortem)
  finalize.rs     重写 → 编译器:同一条证据链编译出 draft Skill/Failure + ReviewBrief + ADR(§5)
  brief.rs        新增:证据链 → ReviewBrief(结构 + markdown 渲染,写盘 ~/.ael/briefs/<task>.md)
  adr.rs          新增:decision 事件 → AdrRecord + adr/NNNN-slug.md 写盘 + CLAUDE.md 约定区同步 + 锚点注释文本生成
  blame.rs        新增:git blame 集成 + commit trailer 解析(AEL-Task: <id>)→ BlameReport(§7)
  policy.rs       新增:策略引擎(policy.toml 解析 + 内置规则 + 判定)(§6)
  redact.rs       新增:transcript 落库前脱敏(内置密钥/凭证模式,替换为 <REDACTED:kind>)
  route.rs        新增:经验驱动路由(skill_usages + tasks 统计 → AgentRecommendation 列表)
  freshness.rs    新增:经验保鲜期(检测 origin_model ≠ 当前模型 → 降级 needs_revalidation;成败计数复活/淘汰)
agent/
  mod.rs          重写接线:send_input 过海关(§6.3);输出流实时签名命中(§6.4);
                  预算熔断(usage.rs 估算);transcript 落库前过 redact;ingest 带 actor/session_id
  config.rs       保留
  context.rs      保留(启动上下文;新增 pre-mortem 风险预报小节,来自 guard)
  usage.rs        保留(token 估算 → BudgetStatus)
  compress.rs     保留
adapter/          保留;ingest() 改为 NewEvent { actor: Ai, session_id: Some(..), .. }
handover/         v2:manifest 升 AHP(§8);pack 增加 briefs/adr/policy_decisions;unpack 兼容 v1
commands/
  task.rs event.rs skill.rs failure.rs search.rs settings.rs handover.rs agent.rs provider.rs  → 对齐 v2 模型
  policy.rs       新增(§4)
  brief.rs        新增
  adr.rs          新增
  blame.rs        新增
  route.rs        新增
```

## 2. 关键路径(AelPaths,已有)

`~/.ael/`:db_file `ael.db` · backups/ · skills/ · handovers/ · briefs/ · settings.json · policy.toml

首次启动:若 policy.toml 不存在,写入内置默认策略(§6.2 全文)。

## 3. Tauri 事件(前端订阅)

| 事件 | payload | 说明 |
|---|---|---|
| `agent://terminal-chunk` | { sessionId, chunk: TerminalChunk } | 保留 |
| `agent://session-status` | { sessionId, session: AgentSession } | 保留 |
| `agent://parsed-event` | { sessionId, event: TaskEvent } | 保留 |
| `gate://pending` | PendingCommand | 新:命令被扣留,请求人工裁决 |
| `gate://decision` | PolicyDecision | 新:每条裁决落账本后广播(含自动放行/拦截) |
| `gate://budget` | { sessionId, budget: BudgetStatus } | 新:预算状态更新;breakerTripped=true 时前端高亮 |
| `guard://signature-hit` | { sessionId, failure: Failure, line: String } | 新:输出流实时命中历史失败签名 |

## 4. IPC v2 命令清单(lib.rs 注册,全部走 AelResult→CommandError)

v1 全部保留(名称与参数不变)。新增:

```
// 海关(出口③)
gate_list_pending()                                    -> Vec<PendingCommand>
gate_resolve_pending(pending_id, approve: bool)        -> PolicyDecision      // 人工放行/拦截
gate_list_decisions(task_id?, session_id?, limit?)     -> Vec<PolicyDecision>
gate_get_policy_text()                                 -> String              // policy.toml 原文
gate_set_policy_text(text)                             -> ()                  // 校验后写盘 + 热加载
gate_test_command(command_text)                        -> PolicyVerdict       // 试运行判定(UI 演示)
gate_get_budget(session_id)                            -> BudgetStatus

// Review Brief(出口①)
compile_brief(task_id)                                 -> ReviewBrief         // 纯读,不落盘
export_brief(task_id)                                  -> String              // 写 ~/.ael/briefs/<task>.md,返回路径

// 活文档(出口④)
list_adrs(task_id?)                                    -> Vec<AdrRecord>
compile_adrs(task_id)                                  -> Vec<AdrRecord>      // decision 事件→ADR(幂等:source_event_id 去重)
export_adrs(task_id, repo_path?)                       -> Vec<String>         // 写 adr/NNNN-*.md,返回路径

// Agent Blame(出口②)
record_commit_link(task_id, session_id?, repo_path, commit_hash) -> CommitLink
list_commit_links(task_id?)                            -> Vec<CommitLink>
blame_line(repo_path, file, line)                      -> BlameReport         // git blame → trailer/commit_links → 决策现场
scan_repo_commits(repo_path)                           -> Vec<CommitLink>     // 扫描 git log 里带 AEL-Task trailer 的提交入库
generate_commit_trailer(task_id)                       -> String              // "AEL-Task: <id>"

// 路由 + 保鲜期(横向)
recommend_agents(goal, tags)                           -> Vec<AgentRecommendation>
run_freshness_check()                                  -> u64                 // 降级条数
revalidate_skill(skill_id)                             -> Skill
```

前端 `lib/ipc.ts` 必须 1:1 覆盖本清单(camelCase 参数)。

## 5. finalize = 编译器

`finalize_task(db, task_id, settings)`:
1. 沿用 v1 提炼 draft Failure(error→fix 配对、签名去重 bump)与 draft Skill(仅 verified),
   填 origin_agent/origin_model(取 task.agent_id + 最近 session 的 agent 版本,取不到则 None)。
2. `brief::compile(db, task_id)` → ReviewBrief。
3. `adr::compile(db, task_id)` → Vec<AdrRecord>(decision 事件,source_event_id 幂等去重)。
4. 返回 FinalizeResult { task, draft_skills, draft_failures, brief, adrs }。

### 5.1 ReviewBrief 组装规则
- decisions:kind=decision → BriefDecision { summary, reason=detail, actor }。
- errors_fixed:error→fix 配对(与 finalize 同配对算法);signature 由 normalize 现算;
  recurrences = failures 表该签名的 occurrences(查不到 = 0)。
- verifications:kind=verification → { summary, evidence_ref }。
- interceptions:policy_decisions 表按 task_id 全量。
- risks:规则生成 —— 无 verification 事件 → "未记录任何验证证据";存在 error 无配对 fix → "存在未修复错误:…";
  存在 human 放行的 hold → "人工放行过高危命令:…";budget breaker 触发过 → "会话曾触发预算熔断"。
- stats:events 总数、sessions 数、tokens_est(会话 usage 估算和)、human_confirmed(actor=human 计数)、
  ai_proposed(actor=ai 计数)、duration_secs(task created→closed/updated)。
- markdown:单页中文模板,分节 GOAL/DECISIONS/ERRORS/VERIFY/INTERCEPTIONS/RISK/STATS,含 task id 与生成时间。

## 6. 运行时海关(policy gate)

### 6.1 判定模型
输入:一条即将写入 PTY 的**完整命令行**(见 6.3 的行缓冲)。
输出:PolicyVerdict { rule_id?, action: allow|warn|hold|deny, reason, matched }。
优先级:deny > hold > warn > allow;多规则命中取最严。内置规则先于用户规则求值,同级后写的覆盖先写的。

### 6.2 policy.toml 格式

**权威格式 = `contracts/policy-default.toml`(已存在,勿改语义)**:
`schema_version = 1`;`[gate]` apply_to_input / scan_output / hold_timeout_secs(默认 120,0=永不超时);
`[budget]` enabled / max_session_tokens(默认 500000)/ warn_ratio(0.8);`[redaction]` enabled;
`[[rules]]` id / action(allow|warn|hold|deny)/ title / patterns(Rust regex 数组,任一命中即触发)。
多规则命中取最严(deny > hold > warn > allow)。预算熔断后:后续含换行输入一律 hold,rule_id="budget"。

解析:新增依赖 `toml = "0.8"`(serde 反序列化),regex 用现有 crate 编译;
任一 pattern 编译失败或 TOML 非法 → invalid_input,保留上一份有效策略(gate_set_policy_text 拒绝写入)。
db::schema::POLICY_DEFAULT_TOML 已 include_str! 该文件;db::init::open 已在缺失时物化到 ~/.ael/policy.toml。

### 6.3 事中裁决接线(agent/mod.rs)· 整行扣留模型
前端控制台**始终以完整命令行(带 `\r\n`)提交输入**;单个控制键(Ctrl-C 等,不含换行)直接透传不裁决。
- `send_input(text)`:当 gate.apply_to_input 且 text 含 `\r`/`\n` 时,取整行命令送策略引擎
  (会话 kind 为 shell 时全量裁决;非 shell 会话仅在预算熔断后裁决):
  - allow → 原样写入 PTY,照旧记 input chunk。
  - warn → 写入 PTY;system chunk `[AEL·海关] 警告(规则 <id>)…`;落账本(verdict=warned, decided_by=policy)。
  - hold → **整行不写入 PTY**(因此无需 Ctrl-C 清行);生成 PendingCommand(uuid、timeout=gate.hold_timeout_secs)
    存入 PolicyGate.pending(含原始文本);emit `gate://pending`;system chunk 留痕。
    后台线程计时,超时未裁决 → verdict=auto_denied 落账本。
    `gate_resolve_pending(id, approve)`:approve → 原文写入 PTY(此刻才回显),verdict=approved, decided_by=human;
    拒绝 → 丢弃,verdict=denied, decided_by=human。两种结局都落账本 + emit `gate://decision` + system chunk。
  - deny → 不写入;verdict=auto_denied, decided_by=policy 落账本 + system chunk。
- 预算熔断:RuntimeSession 维护 input/output 累计字符数 → tokens≈chars/4;跨越 warn_ratio 或 1.0 阈值时
  emit `gate://budget`(只在状态迁移时发,防事件风暴);熔断后新提交命令一律 hold(rule_id="budget")。

### 6.4 事中签名命中(输出流)
`ingest_completed_lines` 内:每行 error 事件入库后,用 normalize 签名查 failures 表;
命中(occurrences≥1)→ emit `guard://signature-hit` + system chunk
`[guard] 签名命中失败库(历史 N 次):<guard_rule>`,并把 guard_rule 作为一条 input 注入?
**不注入**——只提示 + 落 note 事件(actor=guard),避免打断 Agent;由用户决定是否干预。

### 6.5 脱敏(redact.rs)
落 terminal_chunks 前对 text 应用(display 仍发原文给前端 xterm;**落库文本脱敏**):
- `(?i)(api[_-]?key|token|secret|password|authorization)\s*[=:]\s*\S+` → `$1=<REDACTED>`
- `sk-[A-Za-z0-9]{16,}` / `ghp_[A-Za-z0-9]{20,}` / `AKIA[0-9A-Z]{16}` → `<REDACTED:key>`
- `-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----` → `<REDACTED:private-key>`

## 7. Agent Blame

- `generate_commit_trailer(task_id)` → `"AEL-Task: <task_id>"`;前端在任务详情提供复制按钮;
  handover prompt 与 discipline_section 中要求 Agent 提交时带 trailer。
- `scan_repo_commits(repo_path)`:`git log --format=%H%x1f%s%x1f%an%x1f%cI%x1f%b -n 500`,
  解析 body 中 `AEL-Task: <id>` trailer → upsert commit_links(UNIQUE repo_path+commit_hash)。
- `blame_line(repo_path, file, line)`:
  1. `git -C repo blame -L line,line --porcelain -- file` → commit_hash + author + subject。
  2. commit_links 查 hash → task;查不到 → 对该 repo 先增量 scan 再查;仍无 → BlameReport{linked:false, commit 信息照给}。
  3. linked:task + 该 task 全部 sessions 摘要 + decisions(kind=decision)+ human_confirmations(actor=human)
     + guard_events(actor=guard)+ adrs;anchor_file 匹配当前 file 的事件排最前。
- git 调用统一走 `std::process::Command`,Windows 下 `git` 直接可用;错误转 AelError::io_error。

## 8. handover = AHP v1(Agent Handover Protocol)

manifest.json 增加:
```json
{ "ahp_version": "1.0", "generator": "ael/0.2.0", ... 原有字段 ...,
  "brief": "brief.md 相对路径", "adrs": ["adr/....md"],
  "policy_decisions": "policy_decisions.json", "origin": {"agent": "...", "model": "..."} }
```
pack:多写 brief.md(compile_brief 的 markdown)、adr/*.md、policy_decisions.json。
unpack:ahp_version 缺省按 v0(v1 包)兼容导入;新文件缺失不报错。

## 9. 前端(src/ 全量重写)

技术栈不变:React 19 + zustand + tailwind + xterm + lucide。设计语言对齐 `ael-2.0-展示页.html`:

```
石墨底 #0F1216 · 面板 #151A21/#1B222B · 钢白 #E9EDF2 · 记录仪橙 #FF6A2B
通过绿 #3ED598 · 拦截红 #FF5063 · 信息蓝 #5B9BFF · 线 rgba(233,237,242,.12)
中文 Noto Sans SC(系统回退 PingFang/微软雅黑)· 代码 JetBrains Mono(回退 Consolas)
蓝图网格底纹 · 圆角 14px · kicker 小标签(mono 字距 .2em)
```

tailwind.config.cjs 扩展上述色板(bg/panel/panel2/ink/dim/faint/line/accent/pass/hold/info)。

### 视图结构(Sidebar 导航,zustand `view` 字段)
```
overview   总览:四出口状态卡(今日拦截/待裁决/brief 数/ADR 数)+ 最近任务 + 最近裁决
tasks      任务列表 + 任务详情(证据链时间线:actor 徽章 ai/human/guard/system、kind 色点、锚点展示;
           会话列表;操作:finalize(弹 FinalizeResult:草案+brief+adr)、导出 brief、复制 commit trailer、handover)
console    Agents 控制台:会话选择/新建(带启动上下文预览=pre-mortem)、xterm 终端、
           ★ 裁决条:gate://pending 到达时终端上方弹出橙色 HOLD 横幅(命令文本、规则、理由、放行/拦截按钮、倒计时)
           预算仪表(gate://budget)、signature-hit toast
gate       海关:待裁决队列、裁决账本(policy_decisions 表格:action/verdict/decided_by 徽章)、
           policy.toml 编辑器(gate_set_policy_text,校验错误展示)、命令试判器(gate_test_command)
briefs     Review Brief:任务选择 → 结构化 brief(GOAL/DECISIONS/ERRORS/VERIFY/RISK 分节卡)+ markdown 预览/导出
blame      溯源:repo + file + line 输入 → BlameReport 展示(commit 卡、task 卡、决策现场时间线、责任链徽章);
           commit_links 列表 + scan_repo_commits 按钮
memory     经验库:Skills(freshness 徽章「保鲜/待重验」、成败计数、draft→active 确认、revalidate 按钮)
           + Failures(签名、occurrences、guard_rule)+ 路由推荐面板(recommend_agents)
adr        活文档:ADR 列表/详情(status 徽章)、compile_adrs / export_adrs
settings   设置:数据目录/备份、检索模式、guard 阈值、Provider/MCP(保留 v1 功能)、Agent 探测
```

### 组件拆分(components/)
Shell(Sidebar+Header)/ Overview / TaskList / TaskDetail / EvidenceTimeline / FinalizeModal /
Console(Terminal.tsx + GateBanner.tsx + BudgetGauge.tsx + SessionPicker.tsx)/
GateView(PendingQueue + DecisionLedger + PolicyEditor + CommandTester)/
BriefView / BlameView / MemoryView(SkillCard + FailureCard + RoutePanel)/ AdrView / SettingsView /
ui/(Badge Chip Button Panel Modal Toast Kicker Stat)

### store(zustand)
单 store 分片:view / tasks / activeTask+events / sessions+chunks / pending+decisions+budget /
skills / failures / adrs / commitLinks / recommendations / settings / toasts。
事件桥:main.tsx 挂载时 listen 全部 §3 事件 → store action。

## 10. 验收与测试

- `cargo test`:保留并修复既有测试;新增 policy_tests.rs(规则命中/优先级/TOML 解析/超时 auto-deny)、
  brief_tests.rs(配对/风险规则)、blame_tests.rs(trailer 解析)、redact_tests.rs、freshness/route 单测。
- `pnpm typecheck && pnpm build` 通过。
- 契约同步:contracts/ipc-commands.md 增补 v2 命令;README 更新。
- 清理:src.bak/、vite-dev*.log、playwright-report/、test-results/ 删除。
