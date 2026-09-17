//! 证据链命令。seq 由后端分配;list 按 seq 升序。
//! v2:可显式指定 actor(区分 AI 提议 / 人工确认 / Guard 强制)与行级锚点。

use crate::error::AelResult;
use crate::models::{EventActor, EventKind, NewEvent, TaskEvent};
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
    actor: Option<EventActor>,
    session_id: Option<String>,
    anchor_file: Option<String>,
    anchor_lines: Option<String>,
) -> AelResult<TaskEvent> {
    state.db.append_event(NewEvent {
        task_id,
        kind,
        summary,
        detail,
        evidence_ref,
        actor: actor.unwrap_or(EventActor::Human),
        session_id,
        anchor_file,
        anchor_lines,
    })
}

#[tauri::command]
pub fn list_events(state: State<AppState>, task_id: String) -> AelResult<Vec<TaskEvent>> {
    state.db.list_events(&task_id)
}
