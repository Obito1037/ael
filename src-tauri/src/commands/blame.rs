//! Agent Blame IPC(出口②)。commit trailer / 行级溯源 / commit 扫描登记。

use crate::engine::blame;
use crate::error::AelResult;
use crate::models::{BlameReport, CommitLink, NewCommitLink};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrailerResult {
    pub trailer: String,
}

/// 生成提交时应附带的 commit trailer(前端可复制到 commit message)。
#[tauri::command]
pub fn generate_commit_trailer(task_id: String) -> AelResult<TrailerResult> {
    Ok(TrailerResult {
        trailer: blame::commit_trailer(&task_id),
    })
}

/// 手工登记一条 commit ↔ task 链接。
#[tauri::command]
pub fn record_commit_link(
    state: State<AppState>,
    task_id: String,
    session_id: Option<String>,
    repo_path: String,
    commit_hash: String,
    subject: Option<String>,
    author: Option<String>,
    committed_at: Option<String>,
) -> AelResult<CommitLink> {
    state.db.upsert_commit_link(NewCommitLink {
        task_id,
        session_id,
        repo_path,
        commit_hash,
        subject,
        author,
        committed_at,
    })
}

/// 列出某任务的所有 commit 链接。
#[tauri::command]
pub fn list_commit_links(state: State<AppState>, task_id: String) -> AelResult<Vec<CommitLink>> {
    state.db.list_commit_links(&task_id)
}

/// 扫描仓库最近提交,登记带 AEL-Task trailer 的提交。
#[tauri::command]
pub fn scan_repo_commits(state: State<AppState>, repo_path: String) -> AelResult<Vec<CommitLink>> {
    blame::scan_repo_commits(&state.db, &repo_path)
}

/// 对某文件某一行回放决策现场。
#[tauri::command]
pub fn blame_line(
    state: State<AppState>,
    repo_path: String,
    file: String,
    line: u32,
) -> AelResult<BlameReport> {
    blame::blame_line(&state.db, &repo_path, &file, line)
}
