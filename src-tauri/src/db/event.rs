//! task_events 表 CRUD。seq 由本层分配(同一 task 内单调递增)。

use super::Db;
use crate::error::{AelError, AelResult};
use crate::models::{EventKind, NewEvent, TaskEvent};
use crate::util::{new_id, now_iso};
use rusqlite::{params, Row};

const COLS: &str = "id,task_id,seq,kind,summary,detail,evidence_ref,created_at";

fn map_event(row: &Row) -> rusqlite::Result<TaskEvent> {
    let kind_str: String = row.get(3)?;
    Ok(TaskEvent {
        id: row.get(0)?,
        task_id: row.get(1)?,
        seq: row.get(2)?,
        kind: EventKind::from_db(&kind_str).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
        })?,
        summary: row.get(4)?,
        detail: row.get(5)?,
        evidence_ref: row.get(6)?,
        created_at: row.get(7)?,
    })
}

impl Db {
    pub fn append_event(&self, input: NewEvent) -> AelResult<TaskEvent> {
        let id = new_id();
        let now = now_iso();
        let conn = self.lock();

        // task 必须存在(给出明确 not_found,而非裸 FK 报错)。
        let exists: bool = conn
            .query_row(
                "SELECT 1 FROM tasks WHERE id=?1",
                params![input.task_id],
                |_| Ok(true),
            )
            .unwrap_or(false);
        if !exists {
            return Err(AelError::not_found(format!(
                "task {} 不存在",
                input.task_id
            )));
        }

        let seq: i64 = conn.query_row(
            "SELECT COALESCE(MAX(seq),0)+1 FROM task_events WHERE task_id=?1",
            params![input.task_id],
            |r| r.get(0),
        )?;

        conn.execute(
            "INSERT INTO task_events (id,task_id,seq,kind,summary,detail,evidence_ref,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                id,
                input.task_id,
                seq,
                input.kind.as_str(),
                input.summary,
                input.detail,
                input.evidence_ref,
                now,
            ],
        )?;

        let ev = conn.query_row(
            &format!("SELECT {COLS} FROM task_events WHERE id=?1"),
            params![id],
            map_event,
        )?;
        Ok(ev)
    }

    pub fn list_events(&self, task_id: &str) -> AelResult<Vec<TaskEvent>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLS} FROM task_events WHERE task_id=?1 ORDER BY seq ASC"
        ))?;
        let rows = stmt.query_map(params![task_id], map_event)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}
