mod common;

use ael_lib::agent::context::{build_agent_startup_context, BuildAgentStartupContextOptions};
use ael_lib::engine::finalize;
use ael_lib::models::{EventKind, NewEvent, NewTask, SkillStatus, TaskStatus};

fn make_task(state: &ael_lib::state::AppState, title: &str) -> String {
    state
        .db
        .create_task(NewTask {
            title: title.into(),
            goal: "Build a Tauri desktop app on Windows".into(),
            agent_id: Some("codex".into()),
            repo_path: Some("D:/app".into()),
            repo_branch: Some("feat/multi-agent".into()),
            repo_commit: Some("abc123".into()),
            tags: vec!["tauri".into(), "windows".into(), "build".into()],
        })
        .unwrap()
        .id
}

fn append(
    state: &ael_lib::state::AppState,
    task_id: &str,
    kind: EventKind,
    summary: &str,
    detail: Option<&str>,
) {
    state
        .db
        .append_event(NewEvent {
            task_id: task_id.into(),
            kind,
            summary: summary.into(),
            detail: detail.map(str::to_string),
            evidence_ref: None,
        })
        .unwrap();
}

#[test]
fn startup_context_includes_task_guard_skills_events_and_manual_note() {
    let state = common::temp_state();

    let seed = make_task(&state, "Seed Windows Tauri build");
    append(
        &state,
        &seed,
        EventKind::Step,
        "Configure Tauri dependencies",
        None,
    );
    append(
        &state,
        &seed,
        EventKind::Error,
        "link.exe not found",
        Some("MSVC build tools are missing"),
    );
    append(
        &state,
        &seed,
        EventKind::Fix,
        "Install Visual Studio Build Tools with C++ desktop workload",
        None,
    );
    append(
        &state,
        &seed,
        EventKind::Verification,
        "cargo build passes",
        None,
    );
    state
        .db
        .update_task_status(&seed, TaskStatus::Verified)
        .unwrap();
    let finalized = finalize::finalize_task(&state.db, &seed).unwrap();
    assert_eq!(finalized.draft_failures.len(), 1);
    assert_eq!(finalized.draft_skills.len(), 1);
    state
        .db
        .update_skill_status(&finalized.draft_skills[0].id, SkillStatus::Active)
        .unwrap();

    let task = make_task(&state, "Continue multi-agent console");
    append(
        &state,
        &task,
        EventKind::Decision,
        "Use backend-owned startup context",
        Some("Frontend should preview it instead of rebuilding guard logic"),
    );
    append(
        &state,
        &task,
        EventKind::Step,
        "Wire context into the next agent launch",
        None,
    );

    let settings = state.settings_snapshot();
    let context = build_agent_startup_context(
        &state.db,
        &task,
        BuildAgentStartupContextOptions {
            agent_kind: Some("codex".into()),
            profile_id: Some("profile-main".into()),
            manual_note: Some("Run git status before editing.".into()),
            event_limit: Some(5),
            skill_limit: Some(3),
            include_guard: Some(true),
            include_skills: Some(true),
            include_handover: Some(true),
            token_budget: None,
        },
        &settings,
    )
    .unwrap();

    assert_eq!(context.task.id, task);
    assert_eq!(context.recent_events.len(), 2);
    assert!(!context.constraints.is_empty());
    assert_eq!(
        context.constraints[0],
        finalized.draft_failures[0].guard_rule
    );
    assert_eq!(context.matched_failures.len(), 1);
    assert_eq!(context.suggested_skills.len(), 1);
    assert_eq!(context.agent_kind.as_deref(), Some("codex"));
    assert_eq!(context.profile_id.as_deref(), Some("profile-main"));
    assert!(context.tokens_est > 0);
    assert!(context
        .parts
        .iter()
        .any(|part| part.key == "constraints" && part.included));
    assert!(context.handover_excerpt.is_some());

    let prompt = context.prompt;
    assert!(prompt.contains("# Launch Context - Continue multi-agent console"));
    assert!(prompt.contains("## 1. Mandatory Constraints From Failure Guard"));
    assert!(prompt.contains("- Path: D:/app"));
    assert!(prompt.contains("- Branch: feat/multi-agent"));
    assert!(prompt.contains("- Commit: abc123"));
    assert!(prompt.contains("link.exe not found"));
    assert!(prompt.contains("Install Visual Studio Build Tools"));
    assert!(prompt.contains("Use backend-owned startup context"));
    assert!(prompt.contains("Run git status before editing."));
    assert!(prompt.contains("Treat this section as hard constraints"));
}

#[test]
fn startup_context_respects_include_flags_and_token_budget_shape() {
    let state = common::temp_state();
    let task = make_task(&state, "Small launch context");
    let context = build_agent_startup_context(
        &state.db,
        &task,
        BuildAgentStartupContextOptions {
            include_guard: Some(false),
            include_skills: Some(false),
            include_handover: Some(false),
            token_budget: Some(80),
            ..Default::default()
        },
        &state.settings_snapshot(),
    )
    .unwrap();

    assert!(context.constraints.is_empty());
    assert!(context.matched_failures.is_empty());
    assert!(context.suggested_skills.is_empty());
    assert!(context.handover_excerpt.is_none());
    assert!(context.tokens_est > 0);
    assert!(context
        .parts
        .iter()
        .any(|part| part.key == "repo" && part.included));
}

#[test]
fn startup_context_for_missing_task_is_not_found() {
    let state = common::temp_state();
    let err = build_agent_startup_context(
        &state.db,
        "missing-task",
        BuildAgentStartupContextOptions::default(),
        &state.settings_snapshot(),
    )
    .unwrap_err();

    assert_eq!(err.code, "not_found");
}
