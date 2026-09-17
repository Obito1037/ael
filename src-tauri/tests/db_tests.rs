//! 数据层 CRUD 测试(Codex db 模块)。

mod common;

use ael3_lib::models::{
    EventKind, NewEvent, NewFailure, NewSkill, NewTask, Outcome, SkillPatch, SkillStatus,
    TaskStatus,
};

fn sample_task() -> NewTask {
    NewTask {
        title: "构建 Tauri 应用".into(),
        goal: "在 Windows 上首次构建 Tauri 2 应用".into(),
        agent_id: Some("claude_code".into()),
        repo_path: Some("D:/repo".into()),
        repo_branch: Some("main".into()),
        repo_commit: Some("abc123".into()),
        tags: vec!["tauri".into(), "windows".into(), "build".into()],
    }
}

#[test]
fn task_crud_and_status() {
    let s = common::temp_state();
    let t = s.db.create_task(sample_task()).unwrap();
    assert_eq!(t.status, TaskStatus::Pending);
    assert!(t.closed_at.is_none());
    assert_eq!(t.tags.len(), 3);

    let got = s.db.get_task(&t.id).unwrap();
    assert_eq!(got.id, t.id);

    let verified =
        s.db.update_task_status(&t.id, TaskStatus::Verified)
            .unwrap();
    assert_eq!(verified.status, TaskStatus::Verified);
    assert!(verified.closed_at.is_some(), "终态应写 closed_at");

    let all = s.db.list_tasks(None, 50, 0).unwrap();
    assert_eq!(all.len(), 1);
    let filtered = s.db.list_tasks(Some(TaskStatus::Pending), 50, 0).unwrap();
    assert!(filtered.is_empty(), "已无 pending 任务");
}

#[test]
fn events_assign_sequential_seq() {
    let s = common::temp_state();
    let t = s.db.create_task(sample_task()).unwrap();
    for i in 0..3 {
        s.db.append_event(NewEvent::basic(
            t.id.clone(),
            EventKind::Step,
            format!("step {i}"),
            None,
            None,
        ))
        .unwrap();
    }
    let events = s.db.list_events(&t.id).unwrap();
    assert_eq!(events.len(), 3);
    assert_eq!(events[0].seq, 1);
    assert_eq!(events[1].seq, 2);
    assert_eq!(events[2].seq, 3);
}

#[test]
fn append_event_to_missing_task_is_not_found() {
    let s = common::temp_state();
    let err =
        s.db.append_event(NewEvent::basic("nope", EventKind::Note, "x", None, None))
            .unwrap_err();
    assert_eq!(err.code, "not_found");
}

#[test]
fn skill_lifecycle_and_usage_counts() {
    let s = common::temp_state();
    let t = s.db.create_task(sample_task()).unwrap();
    let sk =
        s.db.create_skill(NewSkill {
            name: "skill A".into(),
            trigger: "trigger".into(),
            body: "body".into(),
            tags: vec!["tauri".into()],
            source_task_id: Some(t.id.clone()),
            status: SkillStatus::Draft,
            origin_agent: None,
            origin_model: None,
        })
        .unwrap();
    assert_eq!(sk.version, 1);
    assert_eq!(sk.status, SkillStatus::Draft);

    let upd =
        s.db.update_skill(
            &sk.id,
            SkillPatch {
                body: Some("body v2".into()),
                ..Default::default()
            },
        )
        .unwrap();
    assert_eq!(upd.version, 2, "update 应 version+1");
    assert_eq!(upd.body, "body v2");

    let act =
        s.db.update_skill_status(&sk.id, SkillStatus::Active)
            .unwrap();
    assert_eq!(act.status, SkillStatus::Active);

    // 触发器维护计数
    s.db.record_skill_usage(&sk.id, &t.id, Outcome::Helped)
        .unwrap();
    s.db.record_skill_usage(&sk.id, &t.id, Outcome::Harmful)
        .unwrap();
    let after = s.db.get_skill(&sk.id).unwrap();
    assert_eq!(after.success_count, 1);
    assert_eq!(after.fail_count, 1);
}

#[test]
fn failure_signature_dedup() {
    let s = common::temp_state();
    let mk = |sig: &str| NewFailure {
        task_id: None,
        source_event_id: None,
        signature: sig.into(),
        normalized_text: "error linker not found at <path>".into(),
        description: "链接器找不到".into(),
        root_cause: None,
        fix: Some("装 VS 工具链".into()),
        guard_rule: "构建前确认装了 VS C++ 工具链".into(),
        tags: vec!["tauri".into(), "build".into()],
        origin_agent: None,
        origin_model: None,
    };
    let f = s.db.insert_failure(mk("sig-1")).unwrap();
    assert_eq!(f.occurrences, 1);

    let found = s.db.find_failure_by_signature("sig-1").unwrap();
    assert!(found.is_some());

    let bumped = s.db.bump_failure(&f.id).unwrap();
    assert_eq!(bumped.occurrences, 2, "同签名再现应 occurrences+1");

    assert!(s.db.find_failure_by_signature("absent").unwrap().is_none());
}
