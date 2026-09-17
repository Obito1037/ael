//! 本机 Agent 历史扫描与只读索引命令。

use crate::db::{HistoryConversation, HistoryMessage, HistoryScanSummary};
use crate::error::AelResult;
use crate::history;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn scan_history(state: State<AppState>) -> AelResult<HistoryScanSummary> {
    history::scan(&state.db)
}

#[tauri::command]
pub fn get_history_scan_summary(state: State<AppState>) -> AelResult<Option<HistoryScanSummary>> {
    state.db.latest_history_scan()
}

#[tauri::command]
pub fn list_history_conversations(
    state: State<AppState>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AelResult<Vec<HistoryConversation>> {
    state
        .db
        .list_history_conversations(limit.unwrap_or(100), offset.unwrap_or(0))
}

#[tauri::command]
pub fn get_history_conversation(
    state: State<AppState>,
    id: String,
) -> AelResult<HistoryConversation> {
    state.db.get_history_conversation(&id)
}

#[tauri::command]
pub fn list_history_messages(
    state: State<AppState>,
    conversation_id: String,
) -> AelResult<Vec<HistoryMessage>> {
    state.db.list_history_messages(&conversation_id)
}
