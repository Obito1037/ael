-- AEL3 schema migration 4 -> 5: deterministic cross-agent history index
-- and reviewable Skill/Failure candidates.

CREATE TABLE IF NOT EXISTS history_scan_runs (
    id             TEXT PRIMARY KEY,
    started_at     TEXT NOT NULL,
    ended_at       TEXT NOT NULL,
    files_seen     INTEGER NOT NULL DEFAULT 0,
    conversations  INTEGER NOT NULL DEFAULT 0,
    messages       INTEGER NOT NULL DEFAULT 0,
    source_counts  TEXT NOT NULL DEFAULT '{}',
    new_candidates INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS history_conversations (
    id                TEXT PRIMARY KEY,
    source_agent      TEXT NOT NULL,
    source_path       TEXT NOT NULL,
    source_session_id TEXT NOT NULL,
    title             TEXT NOT NULL DEFAULT '',
    repo_path         TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL,
    message_count     INTEGER NOT NULL DEFAULT 0,
    source_hash       TEXT NOT NULL,
    UNIQUE(source_agent, source_path, source_session_id)
);

CREATE TABLE IF NOT EXISTS history_messages (
    id                   TEXT PRIMARY KEY,
    conversation_id      TEXT NOT NULL REFERENCES history_conversations(id) ON DELETE CASCADE,
    source_message_id    TEXT,
    role                 TEXT NOT NULL DEFAULT 'unknown',
    kind                 TEXT NOT NULL DEFAULT 'message',
    text                 TEXT NOT NULL,
    created_at           TEXT NOT NULL,
    span_start           INTEGER,
    span_end             INTEGER,
    tool_name            TEXT,
    payload_json         TEXT,
    UNIQUE(conversation_id, span_start, span_end)
);

CREATE VIRTUAL TABLE IF NOT EXISTS history_fts USING fts5(
    message_id UNINDEXED,
    conversation_id UNINDEXED,
    source_agent,
    repo_path,
    role,
    kind,
    text
);

CREATE TRIGGER IF NOT EXISTS history_messages_ai AFTER INSERT ON history_messages BEGIN
    INSERT INTO history_fts(message_id, conversation_id, source_agent, repo_path, role, kind, text)
    SELECT new.id, new.conversation_id, c.source_agent, COALESCE(c.repo_path, ''), new.role, new.kind, new.text
    FROM history_conversations c WHERE c.id = new.conversation_id;
END;

CREATE TRIGGER IF NOT EXISTS history_messages_ad AFTER DELETE ON history_messages BEGIN
    DELETE FROM history_fts WHERE message_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS history_messages_au AFTER UPDATE ON history_messages BEGIN
    DELETE FROM history_fts WHERE message_id = old.id;
    INSERT INTO history_fts(message_id, conversation_id, source_agent, repo_path, role, kind, text)
    SELECT new.id, new.conversation_id, c.source_agent, COALESCE(c.repo_path, ''), new.role, new.kind, new.text
    FROM history_conversations c WHERE c.id = new.conversation_id;
END;

CREATE TABLE IF NOT EXISTS skill_candidates (
    id                 TEXT PRIMARY KEY,
    name               TEXT NOT NULL,
    trigger_text       TEXT NOT NULL,
    scope              TEXT NOT NULL DEFAULT '',
    problem            TEXT NOT NULL DEFAULT '',
    steps_json         TEXT NOT NULL DEFAULT '[]',
    anti_patterns_json TEXT NOT NULL DEFAULT '[]',
    verification_json  TEXT NOT NULL DEFAULT '[]',
    tags               TEXT NOT NULL DEFAULT '[]',
    source_sessions    TEXT NOT NULL DEFAULT '[]',
    source_messages    TEXT NOT NULL DEFAULT '[]',
    source_errors      TEXT NOT NULL DEFAULT '[]',
    source_commits     TEXT NOT NULL DEFAULT '[]',
    confidence         REAL NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'candidate'
                       CHECK (status IN ('candidate','accepted','rejected','merged','exported')),
    created_by_agent   TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS failure_candidates (
    id                 TEXT PRIMARY KEY,
    signature          TEXT NOT NULL,
    normalized_text    TEXT NOT NULL,
    description        TEXT NOT NULL,
    root_cause         TEXT,
    fix                TEXT,
    guard_rule         TEXT NOT NULL DEFAULT '',
    tags               TEXT NOT NULL DEFAULT '[]',
    source_sessions    TEXT NOT NULL DEFAULT '[]',
    source_messages    TEXT NOT NULL DEFAULT '[]',
    source_errors      TEXT NOT NULL DEFAULT '[]',
    source_commits     TEXT NOT NULL DEFAULT '[]',
    confidence         REAL NOT NULL DEFAULT 0,
    status             TEXT NOT NULL DEFAULT 'candidate'
                       CHECK (status IN ('candidate','accepted','rejected','merged','exported')),
    created_by_agent   TEXT,
    created_at         TEXT NOT NULL,
    updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_history_conversations_agent
    ON history_conversations(source_agent, updated_at);
CREATE INDEX IF NOT EXISTS idx_history_conversations_repo
    ON history_conversations(repo_path);
CREATE INDEX IF NOT EXISTS idx_history_messages_conversation
    ON history_messages(conversation_id, span_start);
CREATE INDEX IF NOT EXISTS idx_skill_candidates_status
    ON skill_candidates(status, confidence);
CREATE INDEX IF NOT EXISTS idx_failure_candidates_status
    ON failure_candidates(status, confidence);

UPDATE schema_meta SET value='5' WHERE key='version';
