//! Review Brief IPC(出口①)。编译一页审阅证据;可导出到 ~/.ael/briefs/<task>.md。

use crate::engine::brief;
use crate::error::AelResult;
use crate::models::ReviewBrief;
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathResult {
    pub path: String,
}

/// 纯读:把证据链编译成结构化 Review Brief(不落盘)。
#[tauri::command]
pub fn compile_brief(state: State<AppState>, task_id: String) -> AelResult<ReviewBrief> {
    brief::compile(&state.db, &task_id)
}

/// 导出 Brief 的 markdown 到 ~/.ael/briefs/<task>.md,返回路径。
#[tauri::command]
pub fn export_brief(state: State<AppState>, task_id: String) -> AelResult<PathResult> {
    let brief = brief::compile(&state.db, &task_id)?;
    let dest = state.db.paths.briefs.join(format!("{task_id}.md"));
    std::fs::create_dir_all(&state.db.paths.briefs)?;
    std::fs::write(&dest, brief.markdown.as_bytes())?;
    Ok(PathResult {
        path: dest.to_string_lossy().to_string(),
    })
}
