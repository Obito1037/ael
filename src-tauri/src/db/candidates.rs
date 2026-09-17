//! SkillCandidate / FailureCandidate 的可审阅持久化层。
//!
//! 候选与已启用的 Skill/Failure 是两个不同生命周期：候选可以被拒绝，
//! 也可以在人工确认后再转成长期记忆。重复提炼不会覆盖已确认结果。

use super::Db;
use crate::error::{AelError, AelResult};
use crate::models::{NewFailure, NewSkill, Skill, SkillStatus};
use crate::util::now_iso;
use rusqlite::{params, Row};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillCandidate {
    pub id: String,
    pub name: String,
    pub trigger_text: String,
    pub scope: String,
    pub problem: String,
    pub steps: Vec<String>,
    pub anti_patterns: Vec<String>,
    pub verification: Vec<String>,
    pub tags: Vec<String>,
    pub source_sessions: Vec<String>,
    pub source_messages: Vec<String>,
    pub source_errors: Vec<String>,
    pub source_commits: Vec<String>,
    pub confidence: f64,
    pub status: String,
    pub created_by_agent: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FailureCandidate {
    pub id: String,
    pub signature: String,
    pub normalized_text: String,
    pub description: String,
    pub root_cause: Option<String>,
    pub fix: Option<String>,
    pub guard_rule: String,
    pub verification: Vec<String>,
    pub tags: Vec<String>,
    pub source_sessions: Vec<String>,
    pub source_messages: Vec<String>,
    pub source_errors: Vec<String>,
    pub source_commits: Vec<String>,
    pub confidence: f64,
    pub status: String,
    pub created_by_agent: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CandidateExtractionSummary {
    pub skill_candidates: i64,
    pub failure_candidates: i64,
    pub skipped_low_evidence: i64,
}

pub(crate) struct NewSkillCandidate {
    pub id: String,
    pub name: String,
    pub trigger_text: String,
    pub scope: String,
    pub problem: String,
    pub steps: Vec<String>,
    pub anti_patterns: Vec<String>,
    pub verification: Vec<String>,
    pub tags: Vec<String>,
    pub source_sessions: Vec<String>,
    pub source_messages: Vec<String>,
    pub source_errors: Vec<String>,
    pub source_commits: Vec<String>,
    pub confidence: f64,
    pub created_by_agent: Option<String>,
}

pub(crate) struct NewFailureCandidate {
    pub id: String,
    pub signature: String,
    pub normalized_text: String,
    pub description: String,
    pub root_cause: Option<String>,
    pub fix: Option<String>,
    pub guard_rule: String,
    pub verification: Vec<String>,
    pub tags: Vec<String>,
    pub source_sessions: Vec<String>,
    pub source_messages: Vec<String>,
    pub source_errors: Vec<String>,
    pub source_commits: Vec<String>,
    pub confidence: f64,
    pub created_by_agent: Option<String>,
}

const SKILL_COLS: &str = "id,name,trigger_text,scope,problem,steps_json,anti_patterns_json,verification_json,tags,source_sessions,source_messages,source_errors,source_commits,confidence,status,created_by_agent,created_at,updated_at";
const FAILURE_COLS: &str = "id,signature,normalized_text,description,root_cause,fix,guard_rule,verification_json,tags,source_sessions,source_messages,source_errors,source_commits,confidence,status,created_by_agent,created_at,updated_at";

fn json<T: Serialize>(value: &T) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "[]".into())
}

fn vec_json(value: &str) -> Vec<String> {
    serde_json::from_str(value).unwrap_or_default()
}

fn map_skill(row: &Row<'_>) -> rusqlite::Result<SkillCandidate> {
    Ok(SkillCandidate {
        id: row.get(0)?,
        name: row.get(1)?,
        trigger_text: row.get(2)?,
        scope: row.get(3)?,
        problem: row.get(4)?,
        steps: vec_json(&row.get::<_, String>(5)?),
        anti_patterns: vec_json(&row.get::<_, String>(6)?),
        verification: vec_json(&row.get::<_, String>(7)?),
        tags: vec_json(&row.get::<_, String>(8)?),
        source_sessions: vec_json(&row.get::<_, String>(9)?),
        source_messages: vec_json(&row.get::<_, String>(10)?),
        source_errors: vec_json(&row.get::<_, String>(11)?),
        source_commits: vec_json(&row.get::<_, String>(12)?),
        confidence: row.get(13)?,
        status: row.get(14)?,
        created_by_agent: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn map_failure(row: &Row<'_>) -> rusqlite::Result<FailureCandidate> {
    Ok(FailureCandidate {
        id: row.get(0)?,
        signature: row.get(1)?,
        normalized_text: row.get(2)?,
        description: row.get(3)?,
        root_cause: row.get(4)?,
        fix: row.get(5)?,
        guard_rule: row.get(6)?,
        verification: vec_json(&row.get::<_, String>(7)?),
        tags: vec_json(&row.get::<_, String>(8)?),
        source_sessions: vec_json(&row.get::<_, String>(9)?),
        source_messages: vec_json(&row.get::<_, String>(10)?),
        source_errors: vec_json(&row.get::<_, String>(11)?),
        source_commits: vec_json(&row.get::<_, String>(12)?),
        confidence: row.get(13)?,
        status: row.get(14)?,
        created_by_agent: row.get(15)?,
        created_at: row.get(16)?,
        updated_at: row.get(17)?,
    })
}

fn valid_status(status: &str) -> bool {
    matches!(
        status,
        "candidate" | "accepted" | "rejected" | "merged" | "exported"
    )
}

impl Db {
    pub(crate) fn upsert_skill_candidate(
        &self,
        input: NewSkillCandidate,
    ) -> AelResult<SkillCandidate> {
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            &format!(
                "INSERT INTO skill_candidates ({SKILL_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'candidate',?15,?16,?16)
                 ON CONFLICT(id) DO UPDATE SET
                   name=excluded.name, trigger_text=excluded.trigger_text, scope=excluded.scope,
                   problem=excluded.problem, steps_json=excluded.steps_json,
                   anti_patterns_json=excluded.anti_patterns_json, verification_json=excluded.verification_json,
                   tags=excluded.tags, source_sessions=excluded.source_sessions, source_messages=excluded.source_messages,
                   source_errors=excluded.source_errors, source_commits=excluded.source_commits, confidence=excluded.confidence,
                   updated_at=excluded.updated_at WHERE skill_candidates.status='candidate'"
            ),
            params![
                input.id,
                input.name,
                input.trigger_text,
                input.scope,
                input.problem,
                json(&input.steps),
                json(&input.anti_patterns),
                json(&input.verification),
                json(&input.tags),
                json(&input.source_sessions),
                json(&input.source_messages),
                json(&input.source_errors),
                json(&input.source_commits),
                input.confidence,
                input.created_by_agent,
                now,
            ],
        )?;
        drop(conn);
        self.get_skill_candidate(&input.id)
    }

    pub(crate) fn upsert_failure_candidate(
        &self,
        input: NewFailureCandidate,
    ) -> AelResult<FailureCandidate> {
        let now = now_iso();
        let conn = self.lock();
        conn.execute(
            &format!(
                "INSERT INTO failure_candidates ({FAILURE_COLS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'candidate',?15,?16,?16)
                 ON CONFLICT(id) DO UPDATE SET
                   normalized_text=excluded.normalized_text, description=excluded.description,
                   root_cause=excluded.root_cause, fix=excluded.fix, guard_rule=excluded.guard_rule,
                   verification_json=excluded.verification_json, tags=excluded.tags, source_sessions=excluded.source_sessions, source_messages=excluded.source_messages,
                   source_errors=excluded.source_errors, source_commits=excluded.source_commits, confidence=excluded.confidence,
                   updated_at=excluded.updated_at WHERE failure_candidates.status='candidate'"
            ),
            params![
                input.id,
                input.signature,
                input.normalized_text,
                input.description,
                input.root_cause,
                input.fix,
                input.guard_rule,
                json(&input.verification),
                json(&input.tags),
                json(&input.source_sessions),
                json(&input.source_messages),
                json(&input.source_errors),
                json(&input.source_commits),
                input.confidence,
                input.created_by_agent,
                now,
            ],
        )?;
        drop(conn);
        self.get_failure_candidate(&input.id)
    }

    pub fn list_skill_candidates(
        &self,
        status: Option<&str>,
        limit: i64,
    ) -> AelResult<Vec<SkillCandidate>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {SKILL_COLS} FROM skill_candidates {} ORDER BY confidence DESC, updated_at DESC LIMIT ?1",
            if status.is_some() { "WHERE status=?2" } else { "" }
        ))?;
        let mut out = Vec::new();
        if let Some(status) = status {
            let rows = stmt.query_map(params![limit.clamp(1, 500), status], map_skill)?;
            for row in rows {
                out.push(row?);
            }
        } else {
            let rows = stmt.query_map(params![limit.clamp(1, 500)], map_skill)?;
            for row in rows {
                out.push(row?);
            }
        }
        Ok(out)
    }

    pub fn list_failure_candidates(
        &self,
        status: Option<&str>,
        limit: i64,
    ) -> AelResult<Vec<FailureCandidate>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {FAILURE_COLS} FROM failure_candidates {} ORDER BY confidence DESC, updated_at DESC LIMIT ?1",
            if status.is_some() { "WHERE status=?2" } else { "" }
        ))?;
        let mut out = Vec::new();
        if let Some(status) = status {
            let rows = stmt.query_map(params![limit.clamp(1, 500), status], map_failure)?;
            for row in rows {
                out.push(row?);
            }
        } else {
            let rows = stmt.query_map(params![limit.clamp(1, 500)], map_failure)?;
            for row in rows {
                out.push(row?);
            }
        }
        Ok(out)
    }

    pub fn get_skill_candidate(&self, id: &str) -> AelResult<SkillCandidate> {
        let conn = self.lock();
        conn.query_row(
            &format!("SELECT {SKILL_COLS} FROM skill_candidates WHERE id=?1"),
            params![id],
            map_skill,
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                AelError::not_found(format!("SkillCandidate {id} 不存在"))
            }
            other => other.into(),
        })
    }

    pub fn get_failure_candidate(&self, id: &str) -> AelResult<FailureCandidate> {
        let conn = self.lock();
        conn.query_row(
            &format!("SELECT {FAILURE_COLS} FROM failure_candidates WHERE id=?1"),
            params![id],
            map_failure,
        )
        .map_err(|error| match error {
            rusqlite::Error::QueryReturnedNoRows => {
                AelError::not_found(format!("FailureCandidate {id} 不存在"))
            }
            other => other.into(),
        })
    }

    pub fn update_skill_candidate_status(
        &self,
        id: &str,
        status: &str,
    ) -> AelResult<SkillCandidate> {
        if !valid_status(status) {
            return Err(AelError::invalid_input("非法 SkillCandidate 状态"));
        }
        let conn = self.lock();
        let changed = conn.execute(
            "UPDATE skill_candidates SET status=?1,updated_at=?2 WHERE id=?3",
            params![status, now_iso(), id],
        )?;
        drop(conn);
        if changed == 0 {
            return Err(AelError::not_found(format!("SkillCandidate {id} 不存在")));
        }
        self.get_skill_candidate(id)
    }

    pub fn update_failure_candidate_status(
        &self,
        id: &str,
        status: &str,
    ) -> AelResult<FailureCandidate> {
        if !valid_status(status) {
            return Err(AelError::invalid_input("非法 FailureCandidate 状态"));
        }
        let conn = self.lock();
        let changed = conn.execute(
            "UPDATE failure_candidates SET status=?1,updated_at=?2 WHERE id=?3",
            params![status, now_iso(), id],
        )?;
        drop(conn);
        if changed == 0 {
            return Err(AelError::not_found(format!("FailureCandidate {id} 不存在")));
        }
        self.get_failure_candidate(id)
    }

    pub fn new_candidate_id(prefix: &str, seed: &str) -> String {
        format!("{prefix}-{}", super::history::stable_hash(seed))
    }

    /// 转为现有 Skill 生命周期中的 draft，不直接获得 active 召回权。
    pub fn promote_skill_candidate(&self, id: &str) -> AelResult<Skill> {
        let candidate = self.get_skill_candidate(id)?;
        if candidate.status != "candidate" {
            return Err(AelError::conflict(
                "该 SkillCandidate 已经处理，不能重复转化",
            ));
        }
        if candidate.source_messages.len() < 2
            || candidate.verification.is_empty()
            || candidate.confidence < 0.5
        {
            return Err(AelError::invalid_input(
                "候选证据不足，至少需要两条来源消息、验证证据且质量分不低于 0.5",
            ));
        }
        let body = format!(
            "问题：{}\n\n步骤：\n{}\n\n反模式：\n{}\n\n验证：\n{}\n\n来源消息：{}",
            candidate.problem,
            numbered(&candidate.steps),
            numbered(&candidate.anti_patterns),
            numbered(&candidate.verification),
            candidate.source_messages.join(", "),
        );
        let skill = self.create_skill(NewSkill {
            name: candidate.name.clone(),
            trigger: candidate.trigger_text.clone(),
            body,
            tags: candidate.tags.clone(),
            source_task_id: None,
            status: SkillStatus::Draft,
            origin_agent: candidate.created_by_agent.clone(),
            origin_model: None,
        })?;
        let _ = self.update_skill_candidate_status(id, "merged")?;
        Ok(skill)
    }

    pub fn promote_failure_candidate(&self, id: &str) -> AelResult<crate::models::Failure> {
        let candidate = self.get_failure_candidate(id)?;
        if candidate.status != "candidate" {
            return Err(AelError::conflict(
                "该 FailureCandidate 已经处理，不能重复转化",
            ));
        }
        if candidate.source_messages.is_empty()
            || candidate.verification.is_empty()
            || candidate.confidence < 0.5
        {
            return Err(AelError::invalid_input(
                "失败候选必须有来源错误、验证证据且质量分不低于 0.5",
            ));
        }
        let failure = self.insert_failure(NewFailure {
            task_id: None,
            source_event_id: None,
            signature: candidate.signature.clone(),
            normalized_text: candidate.normalized_text.clone(),
            description: candidate.description.clone(),
            root_cause: candidate.root_cause.clone(),
            fix: candidate.fix.clone(),
            guard_rule: candidate.guard_rule.clone(),
            tags: candidate.tags.clone(),
            origin_agent: candidate.created_by_agent.clone(),
            origin_model: None,
        })?;
        let _ = self.update_failure_candidate_status(id, "merged")?;
        Ok(failure)
    }
}

fn numbered(values: &[String]) -> String {
    if values.is_empty() {
        return "（暂无，需人工补充）".into();
    }
    values
        .iter()
        .enumerate()
        .map(|(index, value)| format!("{}. {}", index + 1, value))
        .collect::<Vec<_>>()
        .join("\n")
}
