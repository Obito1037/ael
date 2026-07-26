//! skills 表 CRUD + FTS5 关键词检索。
//! success_count/fail_count 由 skill_usages 触发器维护,本层不直接写。

use super::{tags_from_json, tags_to_json, Db};
use crate::error::{AelError, AelResult};
use crate::models::{NewSkill, Outcome, Skill, SkillPatch, SkillStatus};
use crate::util::{new_id, now_iso};
use rusqlite::{params, Row};

const COLS: &str = "id,name,trigger_text,body,tags,source_task_id,status,version,success_count,fail_count,created_at,updated_at";

fn map_skill(row: &Row) -> rusqlite::Result<Skill> {
    let tags_str: String = row.get(4)?;
    let status_str: String = row.get(6)?;
    Ok(Skill {
        id: row.get(0)?,
        name: row.get(1)?,
        trigger: row.get(2)?,
        body: row.get(3)?,
        tags: tags_from_json(&tags_str),
        source_task_id: row.get(5)?,
        status: SkillStatus::from_db(&status_str).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(6, rusqlite::types::Type::Text, Box::new(e))
        })?,
        version: row.get(7)?,
        success_count: row.get(8)?,
        fail_count: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

impl Db {
    pub fn create_skill(&self, input: NewSkill) -> AelResult<Skill> {
        let id = new_id();
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO skills
             (id,name,trigger_text,body,tags,source_task_id,status,version,success_count,fail_count,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,1,0,0,?8,?8)",
            params![
                id,
                input.name,
                input.trigger,
                input.body,
                tags_to_json(&input.tags),
                input.source_task_id,
                input.status.as_str(),
                now,
            ],
        )?;
        drop(conn);
        self.get_skill(&id)
    }

    pub fn get_skill(&self, id: &str) -> AelResult<Skill> {
        let conn = self.lock();
        let s = conn.query_row(
            &format!("SELECT {COLS} FROM skills WHERE id=?1"),
            params![id],
            map_skill,
        )?;
        Ok(s)
    }

    pub fn list_skills(
        &self,
        status: Option<SkillStatus>,
        limit: i64,
        offset: i64,
    ) -> AelResult<Vec<Skill>> {
        let conn = self.lock();
        let mut out = Vec::new();
        match status {
            Some(s) => {
                let mut stmt = conn.prepare(&format!(
                    "SELECT {COLS} FROM skills WHERE status=?1 ORDER BY updated_at DESC LIMIT ?2 OFFSET ?3"
                ))?;
                let rows = stmt.query_map(params![s.as_str(), limit, offset], map_skill)?;
                for r in rows {
                    out.push(r?);
                }
            }
            None => {
                let mut stmt = conn.prepare(&format!(
                    "SELECT {COLS} FROM skills ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2"
                ))?;
                let rows = stmt.query_map(params![limit, offset], map_skill)?;
                for r in rows {
                    out.push(r?);
                }
            }
        }
        Ok(out)
    }

    pub fn update_skill(&self, id: &str, patch: SkillPatch) -> AelResult<Skill> {
        let current = self.get_skill(id)?;
        let name = patch.name.unwrap_or(current.name);
        let trigger = patch.trigger.unwrap_or(current.trigger);
        let body = patch.body.unwrap_or(current.body);
        let tags = patch.tags.unwrap_or(current.tags);
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "UPDATE skills SET name=?1, trigger_text=?2, body=?3, tags=?4,
                version=version+1, updated_at=?5 WHERE id=?6",
            params![name, trigger, body, tags_to_json(&tags), now, id],
        )?;
        drop(conn);
        self.get_skill(id)
    }

    pub fn update_skill_status(&self, id: &str, status: SkillStatus) -> AelResult<Skill> {
        let now = now_iso();
        let conn = self.lock();
        let affected = conn.execute(
            "UPDATE skills SET status=?1, updated_at=?2 WHERE id=?3",
            params![status.as_str(), now, id],
        )?;
        drop(conn);
        if affected == 0 {
            return Err(AelError::not_found(format!("skill {id} 不存在")));
        }
        self.get_skill(id)
    }

    pub fn record_skill_usage(
        &self,
        skill_id: &str,
        task_id: &str,
        outcome: Outcome,
    ) -> AelResult<()> {
        let id = new_id();
        let now = now_iso();
        let conn = self.lock();
        // 计数交给触发器;此处仅写一条 usage(FK 保证 skill/task 存在)。
        conn.execute(
            "INSERT INTO skill_usages (id,skill_id,task_id,outcome,created_at)
             VALUES (?1,?2,?3,?4,?5)",
            params![id, skill_id, task_id, outcome.as_str(), now],
        )?;
        Ok(())
    }

    /// FTS5 关键词召回。`match_expr` 必须是已净化的 MATCH 表达式;空串直接返回空。
    /// 返回 (Skill, raw_bm25);bm25 越小越相关(SQLite 约定,负数)。
    pub fn fts_search_skills(&self, match_expr: &str, limit: i64) -> AelResult<Vec<(Skill, f64)>> {
        if match_expr.trim().is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {cols}, bm25(skills_fts) AS rank
             FROM skills_fts JOIN skills s ON s.id = skills_fts.skill_id
             WHERE skills_fts MATCH ?1
             ORDER BY rank LIMIT ?2",
            cols = COLS
                .split(',')
                .map(|c| format!("s.{c}"))
                .collect::<Vec<_>>()
                .join(",")
        ))?;
        let rows = stmt.query_map(params![match_expr, limit], |row| {
            let skill = map_skill(row)?;
            let rank: f64 = row.get(12)?;
            Ok((skill, rank))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}
