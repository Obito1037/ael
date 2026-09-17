//! commit_links 表:Agent Blame 溯源账本(commit ↔ task)。

use super::Db;
use crate::error::AelResult;
use crate::models::{CommitLink, NewCommitLink};
use crate::util::{new_id, now_iso};
use rusqlite::{params, OptionalExtension, Row};

const COLS: &str =
    "id,task_id,session_id,repo_path,commit_hash,subject,author,committed_at,created_at";

fn map_link(row: &Row) -> rusqlite::Result<CommitLink> {
    Ok(CommitLink {
        id: row.get(0)?,
        task_id: row.get(1)?,
        session_id: row.get(2)?,
        repo_path: row.get(3)?,
        commit_hash: row.get(4)?,
        subject: row.get(5)?,
        author: row.get(6)?,
        committed_at: row.get(7)?,
        created_at: row.get(8)?,
    })
}

impl Db {
    /// 幂等:同 (repo, hash) 已存在则直接返回既有记录。
    pub fn upsert_commit_link(&self, input: NewCommitLink) -> AelResult<CommitLink> {
        if let Some(existing) = self.find_commit_link(&input.repo_path, &input.commit_hash)? {
            return Ok(existing);
        }
        let id = new_id();
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO commit_links
             (id,task_id,session_id,repo_path,commit_hash,subject,author,committed_at,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                id,
                input.task_id,
                input.session_id,
                input.repo_path,
                input.commit_hash,
                input.subject,
                input.author,
                input.committed_at,
                now,
            ],
        )?;
        let link = conn.query_row(
            &format!("SELECT {COLS} FROM commit_links WHERE id=?1"),
            params![id],
            map_link,
        )?;
        Ok(link)
    }

    pub fn find_commit_link(
        &self,
        repo_path: &str,
        commit_hash: &str,
    ) -> AelResult<Option<CommitLink>> {
        let conn = self.lock();
        let link = conn
            .query_row(
                &format!(
                    "SELECT {COLS} FROM commit_links WHERE repo_path=?1 AND commit_hash=?2 LIMIT 1"
                ),
                params![repo_path, commit_hash],
                map_link,
            )
            .optional()?;
        Ok(link)
    }

    /// blame 反查:只凭 hash(可能是缩写前缀)找链接。
    pub fn find_commit_link_by_hash_prefix(&self, hash: &str) -> AelResult<Option<CommitLink>> {
        let conn = self.lock();
        let link = conn
            .query_row(
                &format!(
                    "SELECT {COLS} FROM commit_links WHERE commit_hash LIKE ?1 || '%' LIMIT 1"
                ),
                params![hash],
                map_link,
            )
            .optional()?;
        Ok(link)
    }

    pub fn list_commit_links(&self, task_id: &str) -> AelResult<Vec<CommitLink>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLS} FROM commit_links WHERE task_id=?1 ORDER BY created_at ASC"
        ))?;
        let rows = stmt.query_map(params![task_id], map_link)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}
