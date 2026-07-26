//! failures 表 CRUD + FTS5 召回。Failure Guard 的数据源。

use super::{tags_from_json, tags_to_json, Db};
use crate::error::AelResult;
use crate::models::{Failure, NewFailure};
use crate::util::{new_id, now_iso};
use rusqlite::{params, OptionalExtension, Row};

// 对外(IPC)字段。表里另有 task_id/source_event_id/normalized_text/embedding/时间戳。
const COLS: &str = "id,signature,description,root_cause,fix,guard_rule,tags,occurrences";

fn map_failure(row: &Row) -> rusqlite::Result<Failure> {
    let tags_str: String = row.get(6)?;
    Ok(Failure {
        id: row.get(0)?,
        signature: row.get(1)?,
        description: row.get(2)?,
        root_cause: row.get(3)?,
        fix: row.get(4)?,
        guard_rule: row.get(5)?,
        tags: tags_from_json(&tags_str),
        occurrences: row.get(7)?,
    })
}

impl Db {
    pub fn get_failure(&self, id: &str) -> AelResult<Failure> {
        let conn = self.lock();
        let f = conn.query_row(
            &format!("SELECT {COLS} FROM failures WHERE id=?1"),
            params![id],
            map_failure,
        )?;
        Ok(f)
    }

    /// 精确签名匹配(决策 2 的强信号:同一个错只命中一条)。
    pub fn find_failure_by_signature(&self, signature: &str) -> AelResult<Option<Failure>> {
        let conn = self.lock();
        let f = conn
            .query_row(
                &format!("SELECT {COLS} FROM failures WHERE signature=?1 LIMIT 1"),
                params![signature],
                map_failure,
            )
            .optional()?;
        Ok(f)
    }

    pub fn list_failures(&self, limit: i64, offset: i64) -> AelResult<Vec<Failure>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLS} FROM failures ORDER BY last_seen_at DESC LIMIT ?1 OFFSET ?2"
        ))?;
        let rows = stmt.query_map(params![limit, offset], map_failure)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn insert_failure(&self, input: NewFailure) -> AelResult<Failure> {
        let id = new_id();
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO failures
             (id,task_id,source_event_id,signature,normalized_text,description,
              root_cause,fix,guard_rule,tags,occurrences,created_at,last_seen_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,1,?11,?11)",
            params![
                id,
                input.task_id,
                input.source_event_id,
                input.signature,
                input.normalized_text,
                input.description,
                input.root_cause,
                input.fix,
                input.guard_rule,
                tags_to_json(&input.tags),
                now,
            ],
        )?;
        drop(conn);
        self.get_failure(&id)
    }

    /// 同签名再次出现:occurrences += 1,刷新 last_seen_at。
    pub fn bump_failure(&self, id: &str) -> AelResult<Failure> {
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "UPDATE failures SET occurrences = occurrences + 1, last_seen_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        drop(conn);
        self.get_failure(id)
    }

    /// FTS5 召回。返回 (Failure, raw_bm25),bm25 越小越相关。
    pub fn fts_search_failures(
        &self,
        match_expr: &str,
        limit: i64,
    ) -> AelResult<Vec<(Failure, f64)>> {
        if match_expr.trim().is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {cols}, bm25(failures_fts) AS rank
             FROM failures_fts JOIN failures f ON f.id = failures_fts.failure_id
             WHERE failures_fts MATCH ?1
             ORDER BY rank LIMIT ?2",
            cols = COLS
                .split(',')
                .map(|c| format!("f.{c}"))
                .collect::<Vec<_>>()
                .join(",")
        ))?;
        let rows = stmt.query_map(params![match_expr, limit], |row| {
            let failure = map_failure(row)?;
            let rank: f64 = row.get(8)?;
            Ok((failure, rank))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}
