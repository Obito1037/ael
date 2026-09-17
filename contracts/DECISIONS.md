# DECISIONS.md · Phase 0 架构决策（FROZEN v1）

记录三个核心决策的结论与理由,以及跨契约的通用约定。后续工具按此实现。

---

## 决策 1 · 检索方案

### MVP:纯本地确定性匹配(retrievalMode = 'keyword')
不引入任何外部模型或服务。三个信号加权打分:

1. **标签重合**:新任务 tags 与 Skill/Failure tags 的 Jaccard 相似度。
2. **错误签名**:`failures.signature` 精确匹配(见决策 2)→ 强信号,直接判定"同一个错"。
3. **关键词全文**:用 SQLite FTS5(schema 里的 `skills_fts` / `failures_fts`)对 name/trigger/body/description 做 BM25 检索。

打分(建议初值,放在 Settings 可调):
```
score = 0.45 * 标签Jaccard + 0.35 * 归一化BM25 + 0.20 * 签名命中(0/1)
```

**关键护栏**:低于 `guardMinScore`(默认 0.35)的结果**不注入**。
拉错经验比不拉更糟——宁可漏报,不要把 Agent 带沟里(见 NOTES.md 第 1 条)。

### 升级路径:hybrid(不改 IPC 签名)
`skills.embedding` / `failures.embedding` 两个 BLOB 列已预留。
Phase 2+ 切换步骤:
1. 引入本地 embedding(候选:fastembed / candle 跑小型句向量模型,纯本地)。
2. 写入/回填 embedding 列。
3. 检索改为 **FTS 先召回候选 → 向量余弦在候选集内重排**(混合检索,既快又准)。

因为 `search_skills(query)` 和 `check_failure_guard` 的**签名不变**,前端零改动,只切 `retrievalMode`。这是平滑过渡的关键:升级是后端内部的事。

---

## 决策 2 · 错误签名(failures.signature)

目标:让"同一个错误"在第二次出现时一定命中。难点是错误信息里混着大量易变 token。

### 归一化流水线(产出 normalized_text,再哈希成 signature)
按顺序替换为占位符:

| 易变内容 | 占位符 | 例 |
|---|---|---|
| 绝对路径 | `<PATH>` | `D:\vs\...\link.exe` → `<PATH>` |
| 行列号 | `<LOC>` | `:42:7` → `<LOC>` |
| 十六进制/内存地址 | `<ADDR>` | `0x7ffd...` → `<ADDR>` |
| UUID / 长哈希 | `<ID>` | |
| 时间戳 | `<TS>` | |
| 引号内的用户值 | `<VAL>` | `'myfile.rs'` → `'<VAL>'` |
| 独立数字 | `<N>` | |

然后:转小写 → 合并连续空白 → 去首尾空白。
得到稳定骨架 `normalized_text`,例如:
```
原始: error: linker `link.exe` not found at D:\vs\bin\link.exe (os error 2) line 42
归一: error: linker `link.exe` not found at <PATH> (os error <N>) line <LOC>
```

`signature = sha1(normalized_text)`。两条都入库:`signature` 用于精确匹配,`normalized_text` 进 FTS 供模糊召回。

### 匹配规则
- `signature` 相等 → 判定同一个错 → `occurrences += 1`、`last_seen_at` 更新,不新建。
- 不等但 `normalized_text` FTS 高度相似 → 作为"疑似相关"提示,不自动合并。

> 注意:数字归一要保守。版本号这类有意义的数字若全抹成 `<N>` 可能过度泛化;MVP 先全归一,误合并的个例靠人工 deprecate 兜底,后续再细化规则。

---

## 决策 3 · finalize_task 的经验提炼规则

任务 finalize 时扫描该任务的 `task_events`(按 seq),按下面规则产出**草案**。所有草案 `status='draft'`,**必须人工确认才转 active**(防噪声)。

### 提炼 Failure(从 error→fix 配对)
- 找每个 `error` 事件,向后找到解决它的 `fix` 事件(理想情况后面还有 `verification` 确认)。
- 生成 draft Failure:
  - `signature` / `normalized_text` ← 对 error 事件做决策 2 的归一化。
  - `source_event_id` ← 该 error 事件 id。
  - `root_cause` ← error 的 detail(或人工补)。
  - `fix` ← fix 事件内容。
  - `guard_rule` ← 由 fix 反写成一句祈使约束(如「构建前确认装了 VS C++ 工具链」)。
- **去重**:若已存在相同 `signature` 的 failure,只 `occurrences += 1`,不新建。

### 提炼 Skill(从成功路径)
- 仅当任务 `status = verified` 时生成 draft Skill(失败/放弃的任务不产 Skill,但其 error→fix 仍产 Failure)。
- 生成:
  - `name` ← 任务 title。
  - `trigger` ← 由 goal + tags 概括成"相似任务的特征",不照抄流水账。
  - `body` ← 按序提取 `step` 与 `decision` 事件 → 步骤 + 关键决策理由 + 末尾的 `verification` 作为"如何验证"。
  - `source_task_id` ← 该任务。
- `decision` 事件里没解决的分歧 → 进 handover 的 `open_questions`。

### 注入闭环
新任务开始 → `check_failure_guard(goal, tags)` 命中这些 active 的 Failure/Skill → 约束注入 → Agent 避开旧坑。
这正是成功标准一(同一个错不再犯)的实现路径。

---

## 通用约定（所有契约共享）

- **ID**:uuid v4(TEXT)。**时间戳**:ISO-8601 UTC 文本。
- **JSON 字段**:tags 等数组以 JSON 文本存 SQLite,默认 `'[]'`。
- **serde**:Rust 结构体统一 `#[serde(rename_all = "camelCase")]`,对齐前端 TS。
- **枚举**:用 SQLite CHECK 约束兜底(status / kind / outcome),非法值写不进库。
- **计数**:`skills.success_count/fail_count` 由 `skill_usages` 的触发器自动维护,业务代码不要手动改,避免漂移。
- **字段映射**:SQL `trigger_text` ↔ JSON/IPC `trigger`,转换在数据层完成。
- **检索护栏**:任何注入给 Agent 的历史经验都要过 `guardMinScore`。
- **schema 版本**:`schema_meta.version` 与 handover 的 `schema_version` 独立维护,破坏性改动各自 +1。

---

## 验证状态
`schema.sql` 已用 SQLite 3.45 实跑验证:建表 / FTS5 / 触发器同步 / 计数自动维护 / CHECK 约束 / 外键级联,全部通过。可直接用于 Phase 1。
