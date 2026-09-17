//! 候选提炼与人工审阅命令。

use crate::db::{CandidateExtractionSummary, FailureCandidate, SkillCandidate};
use crate::error::{AelError, AelResult};
use crate::history::candidates;
use crate::models::{Failure, Skill};
use crate::state::AppState;
use std::path::PathBuf;
use tauri::State;

#[tauri::command]
pub fn extract_history_candidates(state: State<AppState>) -> AelResult<CandidateExtractionSummary> {
    candidates::extract(&state.db)
}

/// 通过用户本机已登录的 ACP Agent 做严格 JSON distillation，再进入同一质量门。
#[tauri::command]
pub fn distill_history_candidates(
    state: State<AppState>,
    profile_id: Option<String>,
    cwd: Option<String>,
    conversation_id: Option<String>,
) -> AelResult<CandidateExtractionSummary> {
    let profile = profile_id.unwrap_or_else(|| "codex".into());
    let working_dir = cwd.map(PathBuf::from).unwrap_or(std::env::current_dir()?);
    let prompt = candidates::build_distillation_prompt(&state.db, conversation_id.as_deref())?;
    let raw = crate::acp::run_json_prompt(&profile, working_dir, prompt)?;
    candidates::ingest_model_json(&state.db, &profile, &raw)
}

#[tauri::command]
pub fn list_skill_candidates(
    state: State<AppState>,
    status: Option<String>,
    limit: Option<i64>,
) -> AelResult<Vec<SkillCandidate>> {
    if let Some(ref value) = status {
        validate_status(value)?;
    }
    state
        .db
        .list_skill_candidates(status.as_deref(), limit.unwrap_or(100))
}

#[tauri::command]
pub fn list_failure_candidates(
    state: State<AppState>,
    status: Option<String>,
    limit: Option<i64>,
) -> AelResult<Vec<FailureCandidate>> {
    if let Some(ref value) = status {
        validate_status(value)?;
    }
    state
        .db
        .list_failure_candidates(status.as_deref(), limit.unwrap_or(100))
}

#[tauri::command]
pub fn update_skill_candidate_status(
    state: State<AppState>,
    id: String,
    status: String,
) -> AelResult<SkillCandidate> {
    state.db.update_skill_candidate_status(&id, &status)
}

#[tauri::command]
pub fn update_failure_candidate_status(
    state: State<AppState>,
    id: String,
    status: String,
) -> AelResult<FailureCandidate> {
    state.db.update_failure_candidate_status(&id, &status)
}

#[tauri::command]
pub fn promote_skill_candidate(state: State<AppState>, id: String) -> AelResult<Skill> {
    state.db.promote_skill_candidate(&id)
}

#[tauri::command]
pub fn promote_failure_candidate(state: State<AppState>, id: String) -> AelResult<Failure> {
    state.db.promote_failure_candidate(&id)
}

fn validate_status(status: &str) -> AelResult<()> {
    if matches!(
        status,
        "candidate" | "accepted" | "rejected" | "merged" | "exported"
    ) {
        Ok(())
    } else {
        Err(AelError::invalid_input("非法候选状态"))
    }
}
