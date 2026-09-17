-- AEL schema migration 1 -> 2: Agent Runtime persistence.

CREATE TABLE IF NOT EXISTS agent_profiles (
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

CREATE TABLE IF NOT EXISTS agent_sessions (
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

CREATE TABLE IF NOT EXISTS terminal_chunks (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    direction  TEXT NOT NULL CHECK (direction IN ('input','output','system')),
    text       TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS workspace_locks (
    id               TEXT PRIMARY KEY,
    repo_path        TEXT NOT NULL,
    owner_session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
    lock_kind        TEXT NOT NULL CHECK (lock_kind IN ('read','write')),
    created_at       TEXT NOT NULL,
    UNIQUE (repo_path, lock_kind)
);

CREATE INDEX IF NOT EXISTS idx_agent_profiles_kind      ON agent_profiles(kind);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_task      ON agent_sessions(task_id, status);
CREATE INDEX IF NOT EXISTS idx_terminal_chunks_session  ON terminal_chunks(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_workspace_locks_repo     ON workspace_locks(repo_path);

UPDATE schema_meta SET value='2' WHERE key='version';
