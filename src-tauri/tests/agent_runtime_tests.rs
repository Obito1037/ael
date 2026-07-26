mod common;

use ael_lib::agent::{
    AgentProfile, AgentSession, AgentSessionStatus, TerminalChunk, TerminalDirection,
    WorkspaceLockKind,
};
use ael_lib::models::NewTask;

fn make_task(state: &ael_lib::state::AppState) -> String {
    state
        .db
        .create_task(NewTask {
            title: "agent task".into(),
            goal: "run a real agent".into(),
            agent_id: Some("codex".into()),
            repo_path: None,
            repo_branch: None,
            repo_commit: None,
            tags: vec!["agent".into()],
        })
        .unwrap()
        .id
}

fn make_session(task_id: &str) -> AgentSession {
    make_session_with("sess-1", task_id, "D:/repo")
}

fn make_session_with(id: &str, task_id: &str, cwd: &str) -> AgentSession {
    AgentSession {
        id: id.into(),
        task_id: task_id.into(),
        profile_id: "codex".into(),
        agent_id: "codex".into(),
        status: AgentSessionStatus::Running,
        cwd: cwd.into(),
        command_line: "codex".into(),
        started_at: "2026-06-08T00:00:00Z".into(),
        updated_at: "2026-06-08T00:00:00Z".into(),
        ended_at: None,
        exit_code: None,
        last_seq: 0,
    }
}

#[test]
fn agent_profile_session_and_chunks_persist() {
    let state = common::temp_state();
    let task_id = make_task(&state);

    state
        .db
        .upsert_agent_profile(&AgentProfile {
            id: "codex".into(),
            kind: "codex".into(),
            display_name: "Codex CLI".into(),
            executable: "codex".into(),
            default_args: vec!["--approval".into(), "never".into()],
            available: true,
            version: Some("codex 1.0".into()),
            path: Some("C:/bin/codex.exe".into()),
        })
        .unwrap();

    let profiles = state.db.list_agent_profiles().unwrap();
    assert_eq!(profiles.len(), 1);
    assert_eq!(
        profiles[0].default_args,
        vec!["--approval".to_string(), "never".to_string()]
    );

    let mut session = make_session(&task_id);
    state.db.insert_agent_session(&session).unwrap();

    state
        .db
        .append_terminal_chunk(&TerminalChunk {
            session_id: session.id.clone(),
            seq: 1,
            direction: TerminalDirection::System,
            text: "started\r\n".into(),
            created_at: "2026-06-08T00:00:01Z".into(),
        })
        .unwrap();
    state
        .db
        .append_terminal_chunk(&TerminalChunk {
            session_id: session.id.clone(),
            seq: 2,
            direction: TerminalDirection::Output,
            text: "error: boom\r\n".into(),
            created_at: "2026-06-08T00:00:02Z".into(),
        })
        .unwrap();

    let chunks = state.db.list_terminal_chunks(&session.id, None).unwrap();
    assert_eq!(chunks.len(), 2);
    assert_eq!(chunks[1].direction.as_str(), "output");

    session.status = AgentSessionStatus::Exited;
    session.ended_at = Some("2026-06-08T00:00:03Z".into());
    session.exit_code = Some(0);
    session.last_seq = 2;
    state.db.update_agent_session(&session).unwrap();

    let listed = state.db.list_agent_sessions(Some(task_id), None).unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].status.as_str(), "exited");
    assert_eq!(listed[0].last_seq, 2);
}

#[test]
fn deleting_task_cascades_agent_sessions_and_transcript() {
    let state = common::temp_state();
    let task_id = make_task(&state);
    let session = make_session(&task_id);
    state.db.insert_agent_session(&session).unwrap();
    state
        .db
        .append_terminal_chunk(&TerminalChunk {
            session_id: session.id.clone(),
            seq: 1,
            direction: TerminalDirection::Input,
            text: "hello\r\n".into(),
            created_at: "2026-06-08T00:00:01Z".into(),
        })
        .unwrap();

    state
        .db
        .delete_task_for_test(&task_id)
        .expect("test helper delete task");

    let sessions = state.db.list_agent_sessions(None, None).unwrap();
    assert!(sessions.is_empty());
    let chunks = state.db.list_terminal_chunks(&session.id, None).unwrap();
    assert!(chunks.is_empty());
}

#[test]
fn stale_running_sessions_are_marked_failed_on_boot_cleanup() {
    let state = common::temp_state();
    let task_id = make_task(&state);
    let session = make_session(&task_id);
    state.db.insert_agent_session(&session).unwrap();
    state
        .db
        .append_terminal_chunk(&TerminalChunk {
            session_id: session.id.clone(),
            seq: 1,
            direction: TerminalDirection::Output,
            text: "partial transcript\r\n".into(),
            created_at: "2026-06-08T00:00:01Z".into(),
        })
        .unwrap();

    state.db.mark_stale_agent_sessions().unwrap();

    let restored = state.db.get_agent_session(&session.id).unwrap();
    assert_eq!(restored.status.as_str(), "failed");
    assert!(restored.ended_at.is_some());

    let chunks = state.db.list_terminal_chunks(&session.id, None).unwrap();
    assert_eq!(chunks.len(), 1);
    assert_eq!(chunks[0].text, "partial transcript\r\n");
}

#[test]
fn workspace_write_lock_blocks_parallel_agent_on_same_repo() {
    let state = common::temp_state();
    let task_id = make_task(&state);
    let session_a = make_session_with("sess-a", &task_id, "D:/repo");
    let session_b = make_session_with("sess-b", &task_id, "D:/repo");
    state.db.insert_agent_session(&session_a).unwrap();
    state.db.insert_agent_session(&session_b).unwrap();

    let lock = state
        .db
        .acquire_workspace_lock("D:/repo", &session_a.id, WorkspaceLockKind::Write)
        .unwrap();
    assert_eq!(lock.owner_session_id, "sess-a");

    let err = state
        .db
        .acquire_workspace_lock("D:/repo", &session_b.id, WorkspaceLockKind::Write)
        .unwrap_err();
    assert_eq!(err.code, "conflict");

    let locks = state.db.list_workspace_locks().unwrap();
    assert_eq!(locks.len(), 1);
}

#[test]
fn workspace_lock_releases_by_session_and_stale_cleanup() {
    let state = common::temp_state();
    let task_id = make_task(&state);
    let mut session = make_session_with("sess-lock", &task_id, "D:/repo");
    state.db.insert_agent_session(&session).unwrap();
    state
        .db
        .acquire_workspace_lock("D:/repo", &session.id, WorkspaceLockKind::Write)
        .unwrap();
    assert_eq!(state.db.list_workspace_locks().unwrap().len(), 1);

    let released = state
        .db
        .release_workspace_locks_for_session(&session.id)
        .unwrap();
    assert_eq!(released, 1);
    assert!(state.db.list_workspace_locks().unwrap().is_empty());

    state
        .db
        .acquire_workspace_lock("D:/repo", &session.id, WorkspaceLockKind::Write)
        .unwrap();
    session.status = AgentSessionStatus::Failed;
    session.ended_at = Some("2026-06-08T00:00:03Z".into());
    state.db.update_agent_session(&session).unwrap();
    state.db.release_stale_workspace_locks().unwrap();
    assert!(state.db.list_workspace_locks().unwrap().is_empty());
}
