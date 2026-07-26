//! 表定义:直接内嵌冻结契约 contracts/schema.sql(唯一事实源)。
//! 已用 SQLite 3.45 实跑验证(见 DECISIONS.md「验证状态」)。

/// 冻结的建库脚本。新库首次初始化时整段执行。
pub const SCHEMA_SQL: &str = include_str!("../../../contracts/schema.sql");

/// v1 → v2:Agent Runtime 会话与 transcript 持久化。
pub const MIGRATION_002_AGENT_RUNTIME: &str =
    include_str!("../../../contracts/migrations/002-agent-runtime.sql");

/// v2 → v3:Provider / MCP server 配置(CC Switch 等价层)。
pub const MIGRATION_003_PROVIDERS_MCP: &str =
    include_str!("../../../contracts/migrations/003-providers-mcp.sql");

/// 当前 schema 版本(对齐 schema_meta.version)。破坏性改动时 +1。
pub const SCHEMA_VERSION: i64 = 3;
