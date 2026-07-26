-- AEL · SQLite schema (v2)
-- 约定:所有 id = uuid v4(TEXT);时间戳 = ISO-8601 UTC 文本;JSON 字段默认 '[]'/'{}'。
-- 字段名映射:SQL 列 trigger_text  ↔  JSON/IPC 字段 trigger(避免 SQL 保留字 TRIGGER)。

PRAGMA foreign_keys = ON;

-- ── 任务主记录 ─────────────────────────────────────────────
CREATE TABLE tasks (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    goal        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','in_progress','blocked','verified','failed','abandoned')),
    agent_id    TEXT,
    repo_path   TEXT,
    repo_branch TEXT,
    repo_commit TEXT,
    tags        TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    closed_at   TEXT
);

-- ── 证据链 ─────────────────────────────────────────────────
CREATE TABLE task_events (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    seq          INTEGER NOT NULL,
    kind         TEXT NOT NULL
                 CHECK (kind IN ('step','error','fix','verification','decision','note')),
    summary      TEXT NOT NULL,
    detail       TEXT,
    evidence_ref TEXT,
    created_at   TEXT NOT NULL,
    UNIQUE (task_id, seq)
);

-- ── Skill ──────────────────────────────────────────────────
CREATE TABLE skills (
    id             TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    trigger_text   TEXT NOT NULL,
    body           TEXT NOT NULL,
    tags           TEXT NOT NULL DEFAULT '[]',
    source_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    status         TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','active','deprecated')),
    version        INTEGER NOT NULL DEFAULT 1,
    embedding      BLOB,
    success_count  INTEGER NOT NULL DEFAULT 0,
    fail_count     INTEGER NOT NULL DEFAULT 0,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);

-- ── Failure(Failure Guard 数据源) ─────────────────────────
CREATE TABLE failures (
    id              TEXT PRIMARY KEY,
    task_id         TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    source_event_id TEXT REFERENCES task_events(id) ON DELETE SET NULL,
    signature       TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    description     TEXT NOT NULL,
    root_cause      TEXT,
    fix             TEXT,
    guard_rule      TEXT NOT NULL,
    tags            TEXT NOT NULL DEFAULT '[]',
    embedding       BLOB,
    occurrences     INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    last_seen_at    TEXT NOT NULL
);

-- ── Skill 复用记录 ─────────────────────────────────────────
CREATE TABLE skill_usages (
    id         TEXT PRIMARY KEY,
    skill_id   TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    outcome    TEXT NOT NULL CHECK (outcome IN ('helped','neutral','harmful')),
    created_at TEXT NOT NULL
);

-- ── 全文检索(关键词层,standalone FTS5,触发器同步) ────────
CREATE VIRTUAL TABLE skills_fts USING fts5(
    skill_id UNINDEXED, name, trigger_text, body, tags
);
CREATE VIRTUAL TABLE failures_fts USING fts5(
    failure_id UNINDEXED, signature, normalized_text, description, fix, tags
);

CREATE TRIGGER skills_ai AFTER INSERT ON skills BEGIN
    INSERT INTO skills_fts(skill_id, name, trigger_text, body, tags)
    VALUES (new.id, new.name, new.trigger_text, new.body, new.tags);
END;
CREATE TRIGGER skills_ad AFTER DELETE ON skills BEGIN
    DELETE FROM skills_fts WHERE skill_id = old.id;
END;
CREATE TRIGGER skills_au AFTER UPDATE ON skills BEGIN
    DELETE FROM skills_fts WHERE skill_id = old.id;
    INSERT INTO skills_fts(skill_id, name, trigger_text, body, tags)
    VALUES (new.id, new.name, new.trigger_text, new.body, new.tags);
END;

CREATE TRIGGER failures_ai AFTER INSERT ON failures BEGIN
    INSERT INTO failures_fts(failure_id, signature, normalized_text, description, fix, tags)
    VALUES (new.id, new.signature, new.normalized_text, new.description, new.fix, new.tags);
END;
CREATE TRIGGER failures_ad AFTER DELETE ON failures BEGIN
    DELETE FROM failures_fts WHERE failure_id = old.id;
END;
CREATE TRIGGER failures_au AFTER UPDATE ON failures BEGIN
    DELETE FROM failures_fts WHERE failure_id = old.id;
    INSERT INTO failures_fts(failure_id, signature, normalized_text, description, fix, tags)
    VALUES (new.id, new.signature, new.normalized_text, new.description, new.fix, new.tags);
END;

-- skill_usages 自动维护 skills 的成败计数(防止计数漂移)
CREATE TRIGGER skill_usages_ai AFTER INSERT ON skill_usages BEGIN
    UPDATE skills SET
        success_count = success_count + (new.outcome = 'helped'),
        fail_count    = fail_count + (new.outcome = 'harmful'),
        updated_at    = new.created_at
    WHERE id = new.skill_id;
END;

CREATE INDEX idx_events_task   ON task_events(task_id, seq);
CREATE INDEX idx_skills_status ON skills(status);
CREATE INDEX idx_failures_sig  ON failures(signature);
CREATE INDEX idx_tasks_status  ON tasks(status);

-- ── Agent Runtime(多 Agent 控制台执行层)───────────────────
CREATE TABLE agent_profiles (
    id               TEXT PRIMARY KEY,
    kind             TEXT NOT NULL,
    display_name     TEXT NOT NULL,
    executable       TEXT NOT NULL,
    default_args     TEXT NOT NULL DEFAULT '[]',
    enabled          INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
    last_detected_at TEXT,
    version          TEXT,
    path             TEXT,
    updated_at       TEXT NOT NULL
);

CREATE TABLE agent_sessions (
    id           TEXT PRIMARY KEY,
    task_id      TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    profile_id   TEXT NOT NULL,
    agent_id     TEXT NOT NULL,
    status       TEXT NOT NULL
                 CHECK (status IN ('starting','running','waiting','blocked','exited','killed','failed')),
    cwd          TEXT NOT NULL,
    command_line TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    ended_at     TEXT,
    exit_code    INTEGER,
    last_seq     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE terminal_chunks (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    direction  TEXT NOT NULL CHECK (direction IN ('input','output','system')),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, seq)
);

CREATE TABLE workspace_locks (
    id               TEXT PRIMARY KEY,
    repo_path        TEXT NOT NULL,
    owner_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    lock_kind        TEXT NOT NULL CHECK (lock_kind IN ('read','write')),
    created_at       TEXT NOT NULL,
    UNIQUE (repo_path, lock_kind)
);

CREATE INDEX idx_agent_profiles_kind      ON agent_profiles(kind);
CREATE INDEX idx_agent_sessions_task      ON agent_sessions(task_id, status);
CREATE INDEX idx_terminal_chunks_session  ON terminal_chunks(session_id, seq);
CREATE INDEX idx_workspace_locks_repo     ON workspace_locks(repo_path);

CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO schema_meta(key, value) VALUES ('version','2');
