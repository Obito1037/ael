//! 表定义:直接内嵌冻结契约 contracts/schema.sql(唯一事实源)。
//! 已用 SQLite 3.45 实跑验证(见 DECISIONS.md「验证状态」)。

/// 冻结的建库脚本。新库首次初始化时整段执行。
pub const SCHEMA_SQL: &str = include_str!("../../../contracts/schema.sql");

/// v1 → v2:Agent Runtime 会话与 transcript 持久化。
pub const MIGRATION_002_AGENT_RUNTIME: &str =
    include_str!("../../../contracts/migrations/002-agent-runtime.sql");

/// v2 → v3:Provider / MCP server 配置兼容层。
pub const MIGRATION_003_PROVIDERS_MCP: &str =
    include_str!("../../../contracts/migrations/003-providers-mcp.sql");

/// v3 → v4:治理层(actor/锚点、保鲜期、海关账本、ADR、commit 溯源)。
pub const MIGRATION_004_GOVERNANCE: &str =
    include_str!("../../../contracts/migrations/004-governance.sql");

/// v4 → v5:跨 Agent 历史索引与可审核候选经验。
pub const MIGRATION_005_HISTORY_CANDIDATES: &str =
    include_str!("../../../contracts/migrations/005-history-candidates.sql");

/// v5 → v6:FailureCandidate 绑定验证证据，未验证失败不能直接进入 Guard。
pub const MIGRATION_006_FAILURE_VERIFICATION: &str =
    include_str!("../../../contracts/migrations/006-failure-candidate-verification.sql");

/// 默认海关策略,首次启动物化到 ~/.ael/policy.toml。
pub const POLICY_DEFAULT_TOML: &str = include_str!("../../../contracts/policy-default.toml");

/// 当前 schema 版本(对齐 schema_meta.version)。破坏性改动时 +1。
pub const SCHEMA_VERSION: i64 = 6;
