//! Agent Runtime 持久化:profile、session、terminal transcript。

use super::{tags_from_json, tags_to_json, Db};
use crate::agent::{
    AgentProfile, AgentSession, AgentSessionStatus, TerminalChunk, TerminalDirection,
    WorkspaceLock, WorkspaceLockKind,
};
use crate::error::{AelError, AelResult};
use crate::util::new_id;
use rusqlite::{params, Row};

const SESSION_COLS: &str = "id,task_id,profile_id,agent_id,status,cwd,command_line,started_at,updated_at,ended_at,exit_code,last_seq";
const CHUNK_COLS: &str = "session_id,seq,direction,text,created_at";
const LOCK_COLS: &str = "id,repo_path,owner_session_id,lock_kind,created_at";

fn map_session(row: &Row) -> rusqlite::Result<AgentSession> {
    let status: String = row.get(4)?;
    Ok(AgentSession {
        id: row.get(0)?,
        task_id: row.get(1)?,
        profile_id: row.get(2)?,
        agent_id: row.get(3)?,
        status: AgentSessionStatus::from_db(&status).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
        })?,
        cwd: row.get(5)?,
        command_line: row.get(6)?,
        started_at: row.get(7)?,
        updated_at: row.get(8)?,
        ended_at: row.get(9)?,
        exit_code: row.get(10)?,
        last_seq: row.get::<_, i64>(11)? as u64,
    })
}

fn map_chunk(row: &Row) -> rusqlite::Result<TerminalChunk> {
    let direction: String = row.get(2)?;
    Ok(TerminalChunk {
        session_id: row.get(0)?,
        seq: row.get::<_, i64>(1)? as u64,
        direction: TerminalDirection::from_db(&direction).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
        })?,
        text: row.get(3)?,
        created_at: row.get(4)?,
    })
}

fn map_lock(row: &Row) -> rusqlite::Result<WorkspaceLock> {
    let lock_kind: String = row.get(3)?;
    Ok(WorkspaceLock {
        id: row.get(0)?,
        repo_path: row.get(1)?,
        owner_session_id: row.get(2)?,
        lock_kind: WorkspaceLockKind::from_db(&lock_kind).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
        })?,
        created_at: row.get(4)?,
    })
}

impl Db {
    pub fn upsert_agent_profile(&self, profile: &AgentProfile) -> AelResult<()> {
        let now = crate::util::now_iso();
        let default_args = tags_to_json(&profile.default_args);
        let conn = self.lock();
        conn.execute(
            "INSERT INTO agent_profiles
             (id,kind,display_name,executable,default_args,enabled,last_detected_at,version,path,updated_at)
             VALUES (?1,?2,?3,?4,?5,1,?6,?7,?8,?9)
             ON CONFLICT(id) DO UPDATE SET
               kind=excluded.kind,
               display_name=excluded.display_name,
               executable=excluded.executable,
               default_args=excluded.default_args,
               last_detected_at=excluded.last_detected_at,
               version=excluded.version,
               path=excluded.path,
               updated_at=excluded.updated_at",
            params![
                profile.id,
                profile.kind,
                profile.display_name,
                profile.executable,
                default_args,
                now,
                profile.version,
                profile.path,
                now
            ],
        )?;
        Ok(())
    }

    pub fn list_agent_profiles(&self) -> AelResult<Vec<AgentProfile>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT id,kind,display_name,executable,default_args,enabled,version,path
             FROM agent_profiles ORDER BY display_name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let default_args: String = row.get(4)?;
            let enabled: i64 = row.get(5)?;
            Ok(AgentProfile {
                id: row.get(0)?,
                kind: row.get(1)?,
                display_name: row.get(2)?,
                executable: row.get(3)?,
                default_args: tags_from_json(&default_args),
                available: enabled == 1,
                version: row.get(6)?,
                path: row.get(7)?,
            })
        })?;

        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn insert_agent_session(&self, session: &AgentSession) -> AelResult<()> {
        let conn = self.lock();
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM tasks WHERE id=?1",
                params![session.task_id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !exists {
            return Err(AelError::not_found(format!(
                "task {} 不存在",
                session.task_id
            )));
        }

        conn.execute(
            "INSERT INTO agent_sessions
             (id,task_id,profile_id,agent_id,status,cwd,command_line,started_at,updated_at,ended_at,exit_code,last_seq)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            params![
                session.id,
                session.task_id,
                session.profile_id,
                session.agent_id,
                session.status.as_str(),
                session.cwd,
                session.command_line,
                session.started_at,
                session.updated_at,
                session.ended_at,
                session.exit_code,
                session.last_seq as i64
            ],
        )?;
        Ok(())
    }

    pub fn update_agent_session(&self, session: &AgentSession) -> AelResult<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE agent_sessions SET
               status=?2,
               updated_at=?3,
               ended_at=?4,
               exit_code=?5,
               last_seq=?6
             WHERE id=?1",
            params![
                session.id,
                session.status.as_str(),
                session.updated_at,
                session.ended_at,
                session.exit_code,
                session.last_seq as i64
            ],
        )?;
        Ok(())
    }

    pub fn list_agent_sessions(
        &self,
        task_id: Option<String>,
        status: Option<String>,
    ) -> AelResult<Vec<AgentSession>> {
        let conn = self.lock();
        let (sql, params_vec): (&str, Vec<String>) = match (task_id, status) {
            (Some(task_id), Some(status)) => (
                &format!(
                    "SELECT {SESSION_COLS} FROM agent_sessions WHERE task_id=?1 AND status=?2 ORDER BY updated_at DESC"
                ),
                vec![task_id, status],
            ),
            (Some(task_id), None) => (
                &format!(
                    "SELECT {SESSION_COLS} FROM agent_sessions WHERE task_id=?1 ORDER BY updated_at DESC"
                ),
                vec![task_id],
            ),
            (None, Some(status)) => (
                &format!(
                    "SELECT {SESSION_COLS} FROM agent_sessions WHERE status=?1 ORDER BY updated_at DESC"
                ),
                vec![status],
            ),
            (None, None) => (
                &format!("SELECT {SESSION_COLS} FROM agent_sessions ORDER BY updated_at DESC"),
                vec![],
            ),
        };

        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(rusqlite::params_from_iter(params_vec), map_session)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_agent_session(&self, session_id: &str) -> AelResult<AgentSession> {
        let conn = self.lock();
        let session = conn.query_row(
            &format!("SELECT {SESSION_COLS} FROM agent_sessions WHERE id=?1"),
            params![session_id],
            map_session,
        )?;
        Ok(session)
    }

    pub fn append_terminal_chunk(&self, chunk: &TerminalChunk) -> AelResult<()> {
        let conn = self.lock();
        conn.execute(
            "INSERT INTO terminal_chunks(id,session_id,seq,direction,text,created_at)
             VALUES (?1,?2,?3,?4,?5,?6)
             ON CONFLICT(session_id,seq) DO NOTHING",
            params![
                new_id(),
                chunk.session_id,
                chunk.seq as i64,
                chunk.direction.as_str(),
                chunk.text,
                chunk.created_at
            ],
        )?;
        conn.execute(
            "UPDATE agent_sessions SET last_seq=MAX(last_seq, ?2), updated_at=?3 WHERE id=?1",
            params![chunk.session_id, chunk.seq as i64, chunk.created_at],
        )?;
        Ok(())
    }

    pub fn list_terminal_chunks(
        &self,
        session_id: &str,
        after_seq: Option<u64>,
    ) -> AelResult<Vec<TerminalChunk>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {CHUNK_COLS} FROM terminal_chunks
             WHERE session_id=?1 AND seq>?2 ORDER BY seq ASC"
        ))?;
        let rows = stmt.query_map(
            params![session_id, after_seq.unwrap_or(0) as i64],
            map_chunk,
        )?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn mark_stale_agent_sessions(&self) -> AelResult<()> {
        let now = crate::util::now_iso();
        let conn = self.lock();
        conn.execute(
            "UPDATE agent_sessions SET
               status='failed',
               updated_at=?1,
               ended_at=COALESCE(ended_at, ?1)
             WHERE status IN ('starting','running','waiting','blocked')",
            params![now],
        )?;
        Ok(())
    }

    pub fn acquire_workspace_lock(
        &self,
        repo_path: &str,
        owner_session_id: &str,
        lock_kind: WorkspaceLockKind,
    ) -> AelResult<WorkspaceLock> {
        let now = crate::util::now_iso();
        let id = new_id();
        let conn = self.lock();

        let existing: Option<WorkspaceLock> = conn
            .query_row(
                &format!("SELECT {LOCK_COLS} FROM workspace_locks WHERE repo_path=?1 AND lock_kind='write'"),
                params![repo_path],
                map_lock,
            )
            .ok();
        if let Some(lock) = existing {
            if lock.owner_session_id != owner_session_id {
                return Err(AelError::conflict(format!(
                    "工作区已被 session {} 占用: {}",
                    lock.owner_session_id, repo_path
                )));
            }
            return Ok(lock);
        }

        conn.execute(
            "INSERT INTO workspace_locks(id,repo_path,owner_session_id,lock_kind,created_at)
             VALUES (?1,?2,?3,?4,?5)",
            params![id, repo_path, owner_session_id, lock_kind.as_str(), now],
        )?;
        let lock = conn.query_row(
            &format!("SELECT {LOCK_COLS} FROM workspace_locks WHERE id=?1"),
            params![id],
            map_lock,
        )?;
        Ok(lock)
    }

    pub fn release_workspace_locks_for_session(&self, session_id: &str) -> AelResult<usize> {
        let conn = self.lock();
        let count = conn.execute(
            "DELETE FROM workspace_locks WHERE owner_session_id=?1",
            params![session_id],
        )?;
        Ok(count)
    }

    pub fn release_stale_workspace_locks(&self) -> AelResult<usize> {
        let conn = self.lock();
        let count = conn.execute(
            "DELETE FROM workspace_locks
             WHERE owner_session_id IN (
               SELECT id FROM agent_sessions
               WHERE status IN ('exited','killed','failed')
             )",
            [],
        )?;
        Ok(count)
    }

    pub fn list_workspace_locks(&self) -> AelResult<Vec<WorkspaceLock>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {LOCK_COLS} FROM workspace_locks ORDER BY created_at DESC"
        ))?;
        let rows = stmt.query_map([], map_lock)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }
}
