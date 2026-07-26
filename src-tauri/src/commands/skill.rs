//! Skill 生命周期命令。create 默认 draft;计数由 DB 触发器维护。

use crate::error::AelResult;
use crate::models::{NewSkill, Outcome, Skill, SkillPatch, SkillStatus};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_skills(
    state: State<AppState>,
    status: Option<SkillStatus>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AelResult<Vec<Skill>> {
    state
        .db
        .list_skills(status, limit.unwrap_or(50), offset.unwrap_or(0))
}

#[tauri::command]
pub fn get_skill(state: State<AppState>, id: String) -> AelResult<Skill> {
    state.db.get_skill(&id)
}

#[tauri::command]
pub fn create_skill(
    state: State<AppState>,
    name: String,
    trigger: String,
    body: String,
    tags: Option<Vec<String>>,
    source_task_id: Option<String>,
) -> AelResult<Skill> {
    state.db.create_skill(NewSkill {
        name,
        trigger,
        body,
        tags: tags.unwrap_or_default(),
        source_task_id,
        status: SkillStatus::Draft,
    })
}

#[tauri::command]
pub fn update_skill(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    trigger: Option<String>,
    body: Option<String>,
    tags: Option<Vec<String>>,
) -> AelResult<Skill> {
    state.db.update_skill(
        &id,
        SkillPatch {
            name,
            trigger,
            body,
            tags,
        },
    )
}

#[tauri::command]
pub fn update_skill_status(
    state: State<AppState>,
    id: String,
    status: SkillStatus,
) -> AelResult<Skill> {
    state.db.update_skill_status(&id, status)
}

#[tauri::command]
pub fn record_skill_usage(
    state: State<AppState>,
    skill_id: String,
    task_id: String,
    outcome: Outcome,
) -> AelResult<()> {
    state.db.record_skill_usage(&skill_id, &task_id, outcome)
}
