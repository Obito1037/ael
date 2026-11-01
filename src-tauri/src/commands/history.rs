//! 本机 Agent 历史扫描与只读索引命令。

use crate::db::{HistoryConversation, HistoryMessage, HistoryScanSummary};
use crate::error::{AelError, AelResult};
use crate::history;
use crate::state::AppState;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, State};

static SCAN_RUNNING: AtomicBool = AtomicBool::new(false);

pub(super) struct HistoryJobGuard;
impl HistoryJobGuard {
    pub(super) fn acquire() -> AelResult<Self> {
        SCAN_RUNNING
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| AelError::conflict("历史扫描或提炼仍在后台运行，请等待完成。"))?;
        Ok(Self)
    }
}
impl Drop for HistoryJobGuard {
    fn drop(&mut self) {
        SCAN_RUNNING.store(false, Ordering::Release);
    }
}

#[tauri::command]
pub async fn scan_history(app: tauri::AppHandle) -> AelResult<HistoryScanSummary> {
    let guard = HistoryJobGuard::acquire()?;
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = guard;
        let state = app.state::<AppState>();
        let db = state.db.history_worker()?;
        history::scan(&db)
    })
    .await
    .map_err(|_| AelError::internal("历史扫描工作线程异常结束，已有索引仍保留。"))?
}

#[tauri::command(async)]
pub fn get_history_scan_summary(state: State<AppState>) -> AelResult<Option<HistoryScanSummary>> {
    state.db.latest_history_scan()
}

#[tauri::command(async)]
pub fn list_history_conversations(
    state: State<AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AelResult<Vec<HistoryConversation>> {
    state
        .db
        .list_history_conversations(limit.unwrap_or(100), offset.unwrap_or(0))
}

#[tauri::command(async)]
pub fn get_history_conversation(
    state: State<AppState>,
    id: String,
) -> AelResult<HistoryConversation> {
    state.db.get_history_conversation(&id)
}

#[tauri::command(async)]
pub fn list_history_messages(
    state: State<AppState>,
    conversation_id: String,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AelResult<Vec<HistoryMessage>> {
    state.db.list_history_message_previews(
        &conversation_id,
        limit.unwrap_or(30),
        offset.unwrap_or(0),
    )
}
