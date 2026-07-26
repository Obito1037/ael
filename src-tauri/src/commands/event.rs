//! 证据链命令。seq 由后端分配;list 按 seq 升序。

use crate::error::AelResult;
use crate::models::{EventKind, NewEvent, TaskEvent};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn append_event(
    state: State<AppState>,
    task_id: String,
    kind: EventKind,
    summary: String,
    detail: Option<String>,
    evidence_ref: Option<String>,
) -> AelResult<TaskEvent> {
    state.db.append_event(NewEvent {
        task_id,
        kind,
        summary,
        detail,
        evidence_ref,
    })
}

#[tauri::command]
pub fn list_events(state: State<AppState>, task_id: String) -> AelResult<Vec<TaskEvent>> {
    state.db.list_events(&task_id)
}
