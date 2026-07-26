# 冻结版相对草案的改动

> Phase 0 产物。把这 5 份覆盖到项目的 contracts/。schema.sql 已用 SQLite 3.45 实跑验证(`python3 validate_schema.py`)。

## schema.sql
- 所有枚举字段加 **CHECK 约束**(status / kind / outcome),非法值写不进库。
- 新增 **FTS5 全文检索表**(skills_fts / failures_fts)+ 同步触发器 —— 这是检索方案"关键词层"的落地,纯 SQLite 无外部依赖。
- 新增 **skill_usages 触发器**,自动维护 skills 的 success_count/fail_count,杜绝计数漂移。
- failures 增 `source_event_id`(指向触发它的证据事件)、`normalized_text`(归一化骨架,供模糊召回+调试)。
- tasks 增 `repo_branch` / `repo_commit`(代码任务交接用)。
- SQL 列 `trigger` 改名 `trigger_text`,**规避 SQL 保留字 TRIGGER**(JSON/IPC 仍叫 trigger,数据层转换)。

## ipc-commands.md
- 新增全局约定:统一 **AelError** 错误形状、serde camelCase、分页默认值、ID/时间戳规范。
- `finalize_task` 返回值补上 **draftFailures**(草案里只有 draftSkills)。
- `GuardResult` 增 **suggestedSkills** —— 任务开始一次调用即拿到"失败约束 + 相关 Skill"全部待注入上下文。
- `search_skills` 返回 **RankedSkill**(带 score),配合 guardMinScore 阈值。
- 补 get_skill / update_skill、Settings(retrievalMode / guardMinScore / maxBackups)。

## handover-schema.json
- task 增 **repo_state**(path/branch/commit);顶层增 ael_version。
- 各枚举显式列出取值;`additionalProperties: false` 收紧结构。

## skill-schema.json
- 注明 `trigger`(JSON) ↔ `trigger_text`(SQL)映射;source_task_id 允许 null。

## DECISIONS.md(新增)
- 三个核心决策的可落地结论:检索方案(MVP keyword + 升级 hybrid 路径)、错误签名归一化流水线、finalize 提炼规则。
