//! Failure Guard 命令。新任务开始时调用一次,拿回要注入的全部上下文。

use crate::engine::guard;
use crate::error::AelResult;
use crate::models::{Failure, GuardResult};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn list_failures(
    state: State<AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AelResult<Vec<Failure>> {
    state
        .db
        .list_failures(limit.unwrap_or(50), offset.unwrap_or(0))
}

#[tauri::command]
pub fn get_failure(state: State<AppState>, id: String) -> AelResult<Failure> {
    state.db.get_failure(&id)
}

#[tauri::command]
pub fn check_failure_guard(
    state: State<AppState>,
    goal: String,
    tags: Option<Vec<String>>,
) -> AelResult<GuardResult> {
    let settings = state.settings_snapshot();
    guard::check_failure_guard(&state.db, &goal, &tags.unwrap_or_default(), &settings)
}
