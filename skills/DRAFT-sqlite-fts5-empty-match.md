# Skill · SQLite FTS5 空 MATCH 表达式会报错

> 实现 AEL 检索层时自举沉淀。DB 里以 skill-schema.json 字段存储,这里是可读副本。

- **id**: draft-fts5-empty-match
- **status**: draft
- **version**: 1
- **tags**: sqlite, fts5, search, rust
- **来源任务**: AEL 经验引擎 / 检索

## Trigger(何时适用)
用 SQLite FTS5 做关键词检索,把用户查询拼成 MATCH 表达式时;尤其查询被分词/过滤后可能为空(全是停用词或过短 token)。

## Body

### 根因
`... WHERE fts MATCH ''`(空串或纯空白)不是「匹配全部」,SQLite 直接抛 OperationalError(malformed MATCH)。

### 约束
- 调 FTS 前必须判空:`if match_expr.trim().is_empty() { return Ok(vec![]) }`。
- 每个 token 用双引号包裹再 OR 连接,避免 token 撞上 FTS 操作符(AND/OR/NEAR/*)。

### 步骤
1. 分词 → 过滤(长度 ≥ 2)→ 去重。
2. 没有有效 token 就直接返回空结果,不发 SQL。
3. 有 token 则拼 `"t1" OR "t2" OR ...` 作为 MATCH 表达式。

### 验证
- 空查询返回空集合、不报错。
- 非空查询能召回种子数据(用内存库 + schema.sql 跑一遍即可验证)。
