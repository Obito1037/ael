//! adrs 表:活文档。decision 事件编译成的架构决策记录,编号全局单调。

use super::Db;
use crate::error::AelResult;
use crate::models::{AdrRecord, AdrStatus, NewAdr};
use crate::util::{new_id, now_iso};
use rusqlite::{params, OptionalExtension, Row};

const COLS: &str =
    "id,task_id,number,title,status,context,decision,consequences,source_event_id,file_path,created_at";

fn map_adr(row: &Row) -> rusqlite::Result<AdrRecord> {
    let status: String = row.get(4)?;
    Ok(AdrRecord {
        id: row.get(0)?,
        task_id: row.get(1)?,
        number: row.get(2)?,
        title: row.get(3)?,
        status: AdrStatus::from_db(&status).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(e))
        })?,
        context: row.get(5)?,
        decision: row.get(6)?,
        consequences: row.get(7)?,
        source_event_id: row.get(8)?,
        file_path: row.get(9)?,
        created_at: row.get(10)?,
    })
}

impl Db {
    /// 编号由本层分配(MAX+1),与插入同锁避免并发撞号。
    pub fn insert_adr(&self, input: NewAdr) -> AelResult<AdrRecord> {
        let id = new_id();
        let now = now_iso();
        let conn = self.lock();
        let number: i64 =
            conn.query_row("SELECT COALESCE(MAX(number),0)+1 FROM adrs", [], |r| {
                r.get(0)
            })?;
        conn.execute(
            "INSERT INTO adrs
             (id,task_id,number,title,status,context,decision,consequences,source_event_id,file_path,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                id,
                input.task_id,
                number,
                input.title,
                input.status.as_str(),
                input.context,
                input.decision,
                input.consequences,
                input.source_event_id,
                input.file_path,
                now,
            ],
        )?;
        let adr = conn.query_row(
            &format!("SELECT {COLS} FROM adrs WHERE id=?1"),
            params![id],
            map_adr,
        )?;
        Ok(adr)
    }

    /// 同一 decision 事件只编译一次(重复 finalize 不刷重复 ADR)。
    pub fn find_adr_by_source_event(&self, event_id: &str) -> AelResult<Option<AdrRecord>> {
        let conn = self.lock();
        let adr = conn
            .query_row(
                &format!("SELECT {COLS} FROM adrs WHERE source_event_id=?1 LIMIT 1"),
                params![event_id],
                map_adr,
            )
            .optional()?;
        Ok(adr)
    }

    pub fn list_adrs(&self, task_id: Option<&str>) -> AelResult<Vec<AdrRecord>> {
        let conn = self.lock();
        let mut out = Vec::new();
        match task_id {
            Some(tid) => {
                let mut stmt = conn.prepare(&format!(
                    "SELECT {COLS} FROM adrs WHERE task_id=?1 ORDER BY number ASC"
                ))?;
                let rows = stmt.query_map(params![tid], map_adr)?;
                for r in rows {
                    out.push(r?);
                }
            }
            None => {
                let mut stmt =
                    conn.prepare(&format!("SELECT {COLS} FROM adrs ORDER BY number ASC"))?;
                let rows = stmt.query_map([], map_adr)?;
                for r in rows {
                    out.push(r?);
                }
            }
        }
        Ok(out)
    }

    pub fn set_adr_file_path(&self, id: &str, file_path: &str) -> AelResult<()> {
        let conn = self.lock();
        conn.execute(
            "UPDATE adrs SET file_path=?1 WHERE id=?2",
            params![file_path, id],
        )?;
        Ok(())
    }
}
