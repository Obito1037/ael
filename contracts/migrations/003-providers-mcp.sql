-- AEL schema migration 2 -> 3: Provider / MCP server 配置(CC Switch 等价层)。
-- 配套 contracts/agent-commands.md。纯新增表,不动既有表。

CREATE TABLE IF NOT EXISTS providers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    target_app  TEXT NOT NULL
                CHECK (target_app IN ('claude','codex','gemini','universal')),
    model       TEXT NOT NULL DEFAULT '',
    endpoint    TEXT NOT NULL DEFAULT '',
    api_key     TEXT NOT NULL DEFAULT '',   -- 本机存储;IPC 仅在保存时接收,test 时使用
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    notes       TEXT,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mcp_servers (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    command     TEXT NOT NULL,
    args        TEXT NOT NULL DEFAULT '[]',  -- JSON 数组
    env         TEXT NOT NULL DEFAULT '{}',  -- JSON 对象
    is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_providers_target ON providers(target_app);

UPDATE schema_meta SET value='3' WHERE key='version';
