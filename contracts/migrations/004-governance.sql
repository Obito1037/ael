-- AEL schema migration 3 -> 4:治理层(AEL 2.0)。
-- 新增:证据责任方 + 行级锚点、经验保鲜期、海关裁决账本、ADR、commit 溯源。
-- 纯增量:ALTER TABLE ADD COLUMN + 新表,不动既有数据。

ALTER TABLE task_events ADD COLUMN actor TEXT NOT NULL DEFAULT 'ai'
    CHECK (actor IN ('ai','human','guard','system'));
ALTER TABLE task_events ADD COLUMN session_id TEXT;
ALTER TABLE task_events ADD COLUMN anchor_file TEXT;
ALTER TABLE task_events ADD COLUMN anchor_lines TEXT;

ALTER TABLE skills ADD COLUMN origin_agent TEXT;
ALTER TABLE skills ADD COLUMN origin_model TEXT;
ALTER TABLE skills ADD COLUMN freshness TEXT NOT NULL DEFAULT 'fresh'
    CHECK (freshness IN ('fresh','needs_revalidation'));
ALTER TABLE skills ADD COLUMN revalidated_at TEXT;

ALTER TABLE failures ADD COLUMN origin_agent TEXT;
ALTER TABLE failures ADD COLUMN origin_model TEXT;

CREATE TABLE IF NOT EXISTS policy_decisions (
    id           TEXT PRIMARY KEY,
    session_id   TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
    task_id      TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    rule_id      TEXT NOT NULL,
    action       TEXT NOT NULL CHECK (action IN ('allow','warn','hold','deny')),
    verdict      TEXT NOT NULL
                 CHECK (verdict IN ('passed','warned','approved','denied','auto_denied')),
    command_text TEXT NOT NULL,
    reason       TEXT NOT NULL,
    decided_by   TEXT NOT NULL CHECK (decided_by IN ('policy','human')),
    created_at   TEXT NOT NULL,
    resolved_at  TEXT
);

CREATE TABLE IF NOT EXISTS adrs (
    id              TEXT PRIMARY KEY,
    task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    number          INTEGER NOT NULL UNIQUE,
    title           TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'accepted'
                    CHECK (status IN ('proposed','accepted','superseded')),
    context        TEXT NOT NULL,
    decision        TEXT NOT NULL,
    consequences    TEXT,
    source_event_id TEXT REFERENCES task_events(id) ON DELETE SET NULL,
    file_path       TEXT,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commit_links (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    session_id   TEXT,
    repo_path    TEXT NOT NULL,
    commit_hash  TEXT NOT NULL,
    subject      TEXT,
    author       TEXT,
    committed_at TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE (repo_path, commit_hash)
);

CREATE INDEX IF NOT EXISTS idx_events_session ON task_events(session_id);
CREATE INDEX IF NOT EXISTS idx_skills_fresh   ON skills(freshness);
CREATE INDEX IF NOT EXISTS idx_policy_session ON policy_decisions(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_policy_task    ON policy_decisions(task_id, created_at);
CREATE INDEX IF NOT EXISTS idx_adrs_task      ON adrs(task_id);
CREATE INDEX IF NOT EXISTS idx_commit_task    ON commit_links(task_id);
CREATE INDEX IF NOT EXISTS idx_commit_hash    ON commit_links(commit_hash);

UPDATE schema_meta SET value='4' WHERE key='version';
