# Skill · 前后端 IPC 形状不一致(接口漂移)

> 这条同时演示一个由「失败」沉淀出来的 Skill——它的 trigger 来自一次真实踩坑。

- **id**: example-ipc-shape-mismatch
- **status**: active
- **version**: 1
- **tags**: tauri, ipc, contract, integration
- **success / fail**: 2 / 1

## Trigger(何时适用)
前端 `invoke` 一个 Tauri 命令时,报反序列化错误 / 字段缺失 / `undefined`,通常发生在前端和后端由不同工具分别实现、对入出参字段的命名或可空性理解不一致时。

## Body

### 根因
前端用 camelCase(如 `taskId`),Rust serde 默认按字段名(可能是 `task_id`),或某字段一方当必填、另一方当可空。

### 约束
- 命令签名以 `contracts/ipc-commands.md` 为唯一事实源,任一方都不得擅自改。
- Rust 结构体统一加 `#[serde(rename_all = "camelCase")]`,与前端 TS 类型对齐。
- 可空字段两端都要标成可空(TS `?` / Rust `Option<T>`)。

### 步骤
1. 打开 ipc-commands.md,核对该命令的入出参。
2. 对齐字段名大小写与可空性。
3. 在 `src/lib/ipc.ts` 用与契约一致的 TS 类型重新封装。
4. 加一条往返测试固定下来。

### 验证
- 该命令 invoke 返回结构与 TS 类型一致,无反序列化报错。

### 对应的 Failure Guard 约束(注入新任务)
> 涉及新增/修改 Tauri 命令时:先更新 contracts/ipc-commands.md,再两端对齐 camelCase 与可空性,最后补往返测试。
