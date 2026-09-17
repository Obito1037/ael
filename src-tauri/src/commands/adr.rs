//! 活文档 IPC(出口④)。decision 事件 → ADR;可导出到仓库 adr/NNNN-*.md。

use crate::engine::adr;
use crate::error::AelResult;
use crate::models::AdrRecord;
use crate::state::AppState;
use tauri::State;

/// 列出 ADR(按 task 过滤,或全库)。
#[tauri::command]
pub fn list_adrs(state: State<AppState>, task_id: Option<String>) -> AelResult<Vec<AdrRecord>> {
    state.db.list_adrs(task_id.as_deref())
}

/// 把某任务的 decision 事件编译成 ADR(幂等)。
#[tauri::command]
pub fn compile_adrs(state: State<AppState>, task_id: String) -> AelResult<Vec<AdrRecord>> {
    adr::compile(&state.db, &task_id)
}

/// 导出为仓库内 adr/NNNN-slug.md,返回写出的路径。repo_path 缺省写到 ~/.ael/adr。
#[tauri::command]
pub fn export_adrs(
    state: State<AppState>,
    task_id: String,
    repo_path: Option<String>,
) -> AelResult<Vec<String>> {
    adr::export(&state.db, &task_id, repo_path.as_deref())
}
