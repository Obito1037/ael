//! skills 表 CRUD + FTS5 关键词检索。
//! success_count/fail_count 由 skill_usages 触发器维护,本层不直接写。
//! v2:origin_agent/origin_model + freshness(经验保鲜期)。

use super::{tags_from_json, tags_to_json, Db};
use crate::error::{AelError, AelResult};
use crate::models::{Freshness, NewSkill, Outcome, Skill, SkillPatch, SkillStatus};
use crate::util::{new_id, now_iso};
use rusqlite::{params, Row};

const COLS: &str = "id,name,trigger_text,body,tags,source_task_id,status,version,success_count,fail_count,origin_agent,origin_model,freshness,revalidated_at,created_at,updated_at";

fn map_skill(row: &Row) -> rusqlite::Result<Skill> {
    let tags_str: String = row.get(4)?;
    let status_str: String = row.get(6)?;
    let fresh_str: String = row.get(12)?;
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
        origin_agent: row.get(10)?,
        origin_model: row.get(11)?,
        freshness: Freshness::from_db(&fresh_str).map_err(|e| {
            rusqlite::Error::FromSqlConversionFailure(12, rusqlite::types::Type::Text, Box::new(e))
        })?,
        revalidated_at: row.get(13)?,
        created_at: row.get(14)?,
        updated_at: row.get(15)?,
    })
}

impl Db {
    pub fn create_skill(&self, input: NewSkill) -> AelResult<Skill> {
        let id = new_id();
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            "INSERT INTO skills
             (id,name,trigger_text,body,tags,source_task_id,status,version,success_count,fail_count,
              origin_agent,origin_model,freshness,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,1,0,0,?8,?9,'fresh',?10,?10)",
            params![
                id,
                input.name,
                input.trigger,
                input.body,
                tags_to_json(&input.tags),
                input.source_task_id,
                input.status.as_str(),
                input.origin_agent,
                input.origin_model,
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

    /// 保鲜期状态迁移。revived=true 时刷新 revalidated_at 并把 origin_model 换成当前版本。
    pub fn set_skill_freshness(
        &self,
        id: &str,
        freshness: Freshness,
        new_origin_model: Option<&str>,
    ) -> AelResult<Skill> {
        let now = now_iso();
        let conn = self.lock();
        let affected = match (freshness, new_origin_model) {
            (Freshness::Fresh, Some(model)) => conn.execute(
                "UPDATE skills SET freshness='fresh', origin_model=?1, revalidated_at=?2, updated_at=?2 WHERE id=?3",
                params![model, now, id],
            )?,
            (Freshness::Fresh, None) => conn.execute(
                "UPDATE skills SET freshness='fresh', revalidated_at=?1, updated_at=?1 WHERE id=?2",
                params![now, id],
            )?,
            (Freshness::NeedsRevalidation, _) => conn.execute(
                "UPDATE skills SET freshness='needs_revalidation', updated_at=?1 WHERE id=?2",
                params![now, id],
            )?,
        };
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

    /// 某 Skill 最近 n 次使用结局(新→旧),保鲜期复活/淘汰判定用。
    pub fn recent_skill_outcomes(&self, skill_id: &str, n: i64) -> AelResult<Vec<Outcome>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT outcome FROM skill_usages WHERE skill_id=?1 ORDER BY created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![skill_id, n], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(Outcome::from_db(&r?)?);
        }
        Ok(out)
    }

    /// 按 Agent kind 聚合任务量与经验成败(智能路由数据源)。
    /// 返回 (agent_kind, task_count, success, fail)。
    pub fn agent_track_records(&self) -> AelResult<Vec<(String, i64, i64, i64)>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(
            "SELECT s.origin_agent,
                    COUNT(DISTINCT s.source_task_id),
                    COALESCE(SUM(s.success_count),0),
                    COALESCE(SUM(s.fail_count),0)
             FROM skills s
             WHERE s.origin_agent IS NOT NULL AND s.origin_agent != ''
             GROUP BY s.origin_agent",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, i64>(3)?,
            ))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
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
            let rank: f64 = row.get(16)?;
            Ok((skill, rank))
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }
}
