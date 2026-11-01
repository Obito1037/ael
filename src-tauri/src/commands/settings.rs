//! 设置 / 维护命令。

use crate::db::init;
use crate::error::AelResult;
use crate::models::{RetrievalMode, Settings};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> AelResult<Settings> {
    Ok(state.settings_snapshot())
}

/// Partial<Settings>:仅覆盖传入字段。data_dir 变更下次启动生效。
#[tauri::command]
pub fn set_settings(
    state: State<AppState>,
    data_dir: Option<String>,
    max_backups: Option<u32>,
    retrieval_mode: Option<RetrievalMode>,
    guard_min_score: Option<f64>,
    codex_model: Option<String>,
) -> AelResult<Settings> {
    let mut guard = state.settings.lock().expect("settings mutex poisoned");
    if let Some(v) = data_dir {
        guard.data_dir = v;
    }
    if let Some(v) = max_backups {
        guard.max_backups = v;
    }
    if let Some(v) = retrieval_mode {
        guard.retrieval_mode = v;
    }
    if let Some(v) = guard_min_score {
        guard.guard_min_score = v.clamp(0.0, 1.0);
    }
    if let Some(v) = codex_model {
        guard.codex_model = v.trim().to_string();
    }
    init::save_settings(&state.db.paths, &guard)?;
    Ok(guard.clone())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathResult {
    pub path: String,
}

#[tauri::command]
pub fn backup_now(state: State<AppState>) -> AelResult<PathResult> {
    let max = state.settings_snapshot().max_backups;
    let path = init::backup_db(&state.db.paths, max)?;
    Ok(PathResult {
        path: path.to_string_lossy().to_string(),
    })
}
