//! policy_decisions 表:海关账本。每次裁决(自动/人工)一条不可变记录。

use super::Db;
use crate::error::AelResult;
use crate::models::{DecidedBy, NewPolicyDecision, PolicyAction, PolicyDecision, PolicyVerdictKind};
use crate::util::{new_id, now_iso};
use rusqlite::{params, Row};

const COLS: &str =
    "id,session_id,task_id,rule_id,action,verdict,command_text,reason,decided_by,created_at,resolved_at";

fn map_decision(row: &Row) -> rusqlite::Result<PolicyDecision> {
    let action: String = row.get(4)?;
    let verdict: String = row.get(5)?;
    let decided_by: String = row.get(8)?;
    let conv = |i: usize, e: crate::error::AelError| {
        rusqlite::Error::FromSqlConversionFailure(i, rusqlite::types::Type::Text, Box::new(e))
    };
    Ok(PolicyDecision {
        id: row.get(0)?,
        session_id: row.get(1)?,
        task_id: row.get(2)?,
        rule_id: row.get(3)?,
        action: PolicyAction::from_db(&action).map_err(|e| conv(4, e))?,
        verdict: PolicyVerdictKind::from_db(&verdict).map_err(|e| conv(5, e))?,
        command_text: row.get(6)?,
        reason: row.get(7)?,
        decided_by: DecidedBy::from_db(&decided_by).map_err(|e| conv(8, e))?,
        created_at: row.get(9)?,
        resolved_at: row.get(10)?,
    })
}

impl Db {
    pub fn insert_policy_decision(&self, input: NewPolicyDecision) -> AelResult<PolicyDecision> {
        let id = new_id();
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO policy_decisions
             (id,session_id,task_id,rule_id,action,verdict,command_text,reason,decided_by,created_at,resolved_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            params![
                id,
                input.session_id,
                input.task_id,
                input.rule_id,
                input.action.as_str(),
                input.verdict.as_str(),
                input.command_text,
                input.reason,
                input.decided_by.as_str(),
                now,
                input.resolved_at,
            ],
        )?;
        let d = conn.query_row(
            &format!("SELECT {COLS} FROM policy_decisions WHERE id=?1"),
            params![id],
            map_decision,
        )?;
        Ok(d)
    }

    /// 账本查询:按会话或任务过滤,时间倒序。
    pub fn list_policy_decisions(
        &self,
        session_id: Option<&str>,
        task_id: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> AelResult<Vec<PolicyDecision>> {
        let conn = self.lock();
        let mut out = Vec::new();
        match (session_id, task_id) {
            (Some(sid), _) => {
                let mut stmt = conn.prepare(&format!(
                    "SELECT {COLS} FROM policy_decisions WHERE session_id=?1
                     ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
                ))?;
                let rows = stmt.query_map(params![sid, limit, offset], map_decision)?;
                for r in rows {
                    out.push(r?);
                }
            }
            (None, Some(tid)) => {
                let mut stmt = conn.prepare(&format!(
                    "SELECT {COLS} FROM policy_decisions WHERE task_id=?1
                     ORDER BY created_at DESC LIMIT ?2 OFFSET ?3"
                ))?;
                let rows = stmt.query_map(params![tid, limit, offset], map_decision)?;
                for r in rows {
                    out.push(r?);
                }
            }
            (None, None) => {
                let mut stmt = conn.prepare(&format!(
                    "SELECT {COLS} FROM policy_decisions
                     ORDER BY created_at DESC LIMIT ?1 OFFSET ?2"
                ))?;
                let rows = stmt.query_map(params![limit, offset], map_decision)?;
                for r in rows {
                    out.push(r?);
                }
            }
        }
        Ok(out)
    }

    /// Brief 用:某任务的拦截类记录(warn/hold/deny 的所有结局,时间正序)。
    pub fn task_interceptions(&self, task_id: &str) -> AelResult<Vec<PolicyDecision>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {COLS} FROM policy_decisions
             WHERE task_id=?1 AND action != 'allow'
             ORDER BY created_at ASC"
        ))?;
        let rows = stmt.query_map(params![task_id], map_decision)?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}
