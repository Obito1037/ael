//! 接手包命令。export/import 转调 Codex 的 handover 模块;prompt 由 engine 生成。

use crate::engine::handover as engine_handover;
use crate::error::AelResult;
use crate::handover;
use crate::models::HandoverInclude;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathResult {
    pub path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskIdResult {
    pub task_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptResult {
    pub prompt: String,
}

#[tauri::command]
pub fn export_handover(
    state: State<AppState>,
    task_id: String,
    include: Option<HandoverInclude>,
) -> AelResult<PathResult> {
    let path = handover::export_handover(state.inner(), &task_id, include)?;
    Ok(PathResult {
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn import_handover(state: State<AppState>, path: String) -> AelResult<TaskIdResult> {
    let task_id = handover::import_handover(state.inner(), &path)?;
    Ok(TaskIdResult { task_id })
}

#[tauri::command]
pub fn generate_handover_prompt(
    state: State<AppState>,
    task_id: String,
) -> AelResult<PromptResult> {
    let settings = state.settings_snapshot();
    let prompt = engine_handover::generate_handover_prompt(&state.db, &task_id, &settings)?;
    Ok(PromptResult { prompt })
}
