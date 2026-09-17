# AEL 后端实现说明

后端骨架 + 经验引擎 + 数据层/handover/适配模块**已集成,端到端打通**。下面是地盘边界、模块接口清单与验收状态。

## 地盘与实现

**Claude Code 地盘**
- `src/lib.rs` / `main.rs` —— Tauri 2 入口,注册 contracts/ipc-commands.md 全部 22 个命令。
- `src/commands/` —— IPC 命令薄封装(task / event / skill / search / failure / handover / settings)。
- `src/engine/` —— 经验引擎:`normalize`(错误签名归一化 + sha1)、`finalize`(error→fix 出 draft Failure;verified 任务出 draft Skill)、`guard`(check_failure_guard)、`search`(标签 Jaccard + BM25 + 阈值)、`handover`(接手 Prompt 生成)。

**Codex 地盘(已集成进后端,随时可由 Codex 替换内部实现)**
- `src/db/` —— rusqlite 数据层,内嵌 contracts/schema.sql,原子写入 + 启动备份轮转。
- `src/handover/` —— handover.zip 打包/解析,严格对齐 contracts/handover-schema.json。
- `src/adapter/` —— 多 Agent 适配,**已接入链路**:`adapter::ingest` 把 Agent 原始输出按行归一成 typed 证据事件并落库,error/fix/verify 行会被 finalize 提炼。
- `tests/` —— 集成测试(db / handover / adapter / e2e)。

## 模块 pub 接口清单(供跨模块调用)

`db::Db`
: `create_task / get_task / list_tasks / update_task_status`、`append_event / list_events`、`list_skills / get_skill / create_skill / update_skill / update_skill_status / record_skill_usage / fts_search_skills`、`get_failure / find_failure_by_signature / list_failures / insert_failure / bump_failure / fts_search_failures`。

`db::init`
: `default_paths / paths_for / open / load_settings / save_settings / atomic_write / backup_db`。

`engine`
: `finalize::finalize_task(&Db, id)`、`guard::check_failure_guard(&Db, goal, tags, &Settings)`、`search::{ranked_skills, matched_failures, suggested_skills, tokenize, jaccard, build_match_expr}`、`handover::generate_handover_prompt(&Db, id, &Settings)`、`normalize::{normalize, signature_of, normalize_and_sign}`。

`handover`
: `export_handover(&AppState, task_id, Option<HandoverInclude>) -> PathBuf`、`import_handover(&AppState, path) -> task_id`。

`adapter`
: `adapter_for(agent_id) -> Box<dyn OutputAdapter>`、`ingest(&Db, task_id, agent_id, raw) -> Vec<TaskEvent>`。

`state::AppState`
: `bootstrap()`(~/.ael)、`open_at(root)`(测试/自定义目录)、`settings_snapshot()`。

## 验收状态

全链路无断点(GUI 操作 → SQLite 落库 → handover.zip 导出),已用可执行脚本逐段验证:

1. Agent 输出经 adapter 归一并落入 SQLite 证据链。
2. verified 任务 finalize → draft Skill + draft Failure。
3. 草案经人工确认转 active(模拟 GUI 审核)。
4. 相似新任务 check_failure_guard 命中历史失败 + 推荐 Skill + 注入约束。
5. 不相关任务被 guardMinScore 阈值护栏过滤,不误注入。
6. 同一错误(仅路径/数字不同)签名去重:occurrences+1,不新建。
7. handover.zip 导出含 manifest.json / handover_prompt.md / evidence/。
8. manifest.json 通过 contracts/handover-schema.json 校验。
9. schema.sql 经 contracts/validate_schema.py 实跑通过。

## 验证方式

- 权威:`cd src-tauri && cargo test`(tests/ 下 db / handover / adapter / e2e 全套)。
- 无 Rust 工具链时:`python3 src-tauri/verify_e2e.py` —— 复刻各层实际操作跑通整链,并用真实契约校验产物。

## Phase 3 · 联调与接入点

**两个验收场景已通过**(`python3 src-tauri/verify_scenarios.py` 可复跑,并打印实际接手 Prompt;Rust 权威测试见 `tests/scenarios_tests.rs`):

1. 不重复犯错:制造失败 → 进 failures(带 signature + guard_rule)→ 相似新任务开始时 `check_failure_guard` 注入了该 guard_rule 约束。
2. 零上下文接手:任务受阻 → 导出 handover.zip → `generate_handover_prompt` 产出自给自足的 Prompt(含决策+理由、踩过的坑+处理、仓库对齐、下一步),交给另一个 Agent 即可继续。

**接缝修复**:`generate_handover_prompt` 增加「此前的坑与决策(本任务,接手必读)」提炼段——只甩时间线不够,必须显式提炼决策与坑(见 skills/DRAFT-handover-self-sufficiency.md)。

**接入点预留**:见 `contracts/INTEGRATION-POINTS.md`——对外 API / 配置兼容层 / MCP 三者都挂在现有冻结的只读查询面上,handover.zip 自包含且带版本可跨程序消费。均为增量预留,**未改任何冻结契约**。

## 集成要点

1. **入参大小写**:前端 invoke 传 camelCase,Tauri 自动映射到 snake_case 函数参数。
2. **数据目录**:`~/.ael/`(ael.db / backups / skills / handovers / settings.json)首次启动自动创建。
3. **构建依赖**:Windows 需 VS C++ Build Tools + WebView2(见 skills/EXAMPLE-tauri-build-fix.md)。
4. **检索升级**:schema 已留 embedding 列;切 hybrid 只动 engine 内部,IPC 签名不变。
5. **Agent 桥接**:真实 Agent 跑完后调 `adapter::ingest` 入库即接入闭环;它不属于前端 GUI 的手动操作路径,因此不占用冻结的 IPC 命令面。

## 已知限制

- 本环境无 Rust 工具链,未实跑 `cargo build/test`;代码按各 crate API 逐处自查,逻辑用 verify_e2e.py 验证。首次 `cargo check` 可能有零星需微调处。
- handover 的 evidence/ 目前仅建目录,按 evidence_ref 实际拷贝文件留待补。
- icons/ 为占位图标,正式发版前替换。
