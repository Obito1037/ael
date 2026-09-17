//! 任务相关命令(contracts/ipc-commands.md)。
//! JS 端 camelCase 入参由 Tauri 自动映射到 snake_case 函数参数。

use crate::engine::finalize;
use crate::error::AelResult;
use crate::models::{FinalizeResult, NewTask, Task, TaskStatus};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn create_task(
    state: State<AppState>,
    title: String,
    goal: String,
    agent_id: Option<String>,
    repo_path: Option<String>,
    repo_branch: Option<String>,
    repo_commit: Option<String>,
    tags: Option<Vec<String>>,
) -> AelResult<Task> {
    state.db.create_task(NewTask {
        title,
        goal,
        agent_id,
        repo_path,
        repo_branch,
        repo_commit,
        tags: tags.unwrap_or_default(),
    })
}

#[tauri::command]
pub fn get_task(state: State<AppState>, id: String) -> AelResult<Task> {
    state.db.get_task(&id)
}

#[tauri::command]
pub fn list_tasks(
    state: State<AppState>,
    status: Option<TaskStatus>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AelResult<Vec<Task>> {
    state
        .db
        .list_tasks(status, limit.unwrap_or(50), offset.unwrap_or(0))
}

#[tauri::command]
pub fn update_task_status(
    state: State<AppState>,
    id: String,
    status: TaskStatus,
) -> AelResult<Task> {
    state.db.update_task_status(&id, status)
}

#[tauri::command]
pub fn finalize_task(state: State<AppState>, id: String) -> AelResult<FinalizeResult> {
    finalize::finalize_task(&state.db, &id)
}
