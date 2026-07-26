//! Phase 3 两个必须通过的验收场景。

mod common;

use ael_lib::engine::{finalize, guard, handover as engine_handover};
use ael_lib::handover;
use ael_lib::models::{EventKind, NewEvent, NewTask, TaskStatus};

fn append(
    s: &ael_lib::state::AppState,
    task_id: &str,
    kind: EventKind,
    summary: &str,
    detail: Option<&str>,
) {
    s.db.append_event(NewEvent {
        task_id: task_id.into(),
        kind,
        summary: summary.into(),
        detail: detail.map(|d| d.into()),
        evidence_ref: None,
    })
    .unwrap();
}

/// 场景 1:不重复犯错。
/// 制造失败 → 进 failures(带 signature + guard_rule) → 相似新任务开始时 Guard 注入约束。
#[test]
fn scenario_1_no_repeat_mistake() {
    let s = common::temp_state();
    let tags = vec!["tauri".to_string(), "windows".into(), "build".into()];

    let t =
        s.db.create_task(NewTask {
            title: "首次构建 Tauri".into(),
            goal: "在 Windows 上构建 Tauri 2 桌面应用".into(),
            agent_id: Some("claude_code".into()),
            repo_path: None,
            repo_branch: None,
            repo_commit: None,
            tags: tags.clone(),
        })
        .unwrap();

    append(&s, &t.id, EventKind::Step, "配置 Cargo 依赖", None);
    append(
        &s,
        &t.id,
        EventKind::Error,
        "linker `link.exe` not found",
        Some("Windows 缺少 VS C++ 工具链"),
    );
    append(
        &s,
        &t.id,
        EventKind::Fix,
        "安装 VS Build Tools 并勾选 C++ 桌面开发",
        None,
    );
    s.db.update_task_status(&t.id, TaskStatus::Failed).unwrap();

    // 失败任务也提炼 Failure(只有 Skill 要求 verified)。
    let res = finalize::finalize_task(&s.db, &t.id).unwrap();
    assert_eq!(res.draft_skills.len(), 0, "失败任务不产 Skill");
    assert_eq!(res.draft_failures.len(), 1, "应产出一条 Failure");
    let f = &res.draft_failures[0];
    assert!(!f.signature.is_empty(), "Failure 必须带 signature");
    assert!(!f.guard_rule.is_empty(), "Failure 必须带 guard_rule");

    // 相似新任务开始 → Guard 注入约束。
    let settings = s.settings_snapshot();
    let g = guard::check_failure_guard(&s.db, "再次在 Windows 上构建 Tauri 应用", &tags, &settings)
        .unwrap();
    assert!(!g.matched_failures.is_empty(), "相似任务必须命中历史失败");
    assert!(!g.constraints.is_empty(), "必须注入约束");
    assert_eq!(
        g.constraints[0], f.guard_rule,
        "注入的约束应正是该失败的 guard_rule"
    );
    assert!(
        g.handover_prompt.contains(&f.guard_rule),
        "提醒文本应含约束"
    );
}

/// 场景 2:零上下文接手。
/// 任务执行到一半置为受阻 → 导出 handover.zip → 生成接手 Prompt →
/// Prompt 自给自足(含此前的决策与坑 + 下一步),无需重新解释。
#[test]
fn scenario_2_zero_context_handoff() {
    let s = common::temp_state();

    let t =
        s.db.create_task(NewTask {
            title: "实现登录模块".into(),
            goal: "为应用实现 JWT 登录与会话刷新".into(),
            agent_id: Some("claude_code".into()),
            repo_path: Some("D:/app".into()),
            repo_branch: Some("feat/auth".into()),
            repo_commit: Some("9a8b7c".into()),
            tags: vec!["auth".into(), "frontend".into()],
        })
        .unwrap();

    append(&s, &t.id, EventKind::Step, "搭建登录路由与表单", None);
    append(
        &s,
        &t.id,
        EventKind::Decision,
        "采用 JWT 而非服务端 session",
        Some("前后端分离、无状态,水平扩展更简单"),
    );
    append(
        &s,
        &t.id,
        EventKind::Error,
        "token 校验中间件返回 401",
        Some("密钥读取早于环境变量加载"),
    );
    append(
        &s,
        &t.id,
        EventKind::Fix,
        "调整初始化顺序,先加载 env 再注册中间件",
        None,
    );
    append(
        &s,
        &t.id,
        EventKind::Step,
        "刷新令牌逻辑写到一半,尚未完成",
        None,
    );

    // 执行到一半 → 受阻(非终态,不写 closed_at)。
    let blocked = s.db.update_task_status(&t.id, TaskStatus::Blocked).unwrap();
    assert_eq!(blocked.status, TaskStatus::Blocked);
    assert!(blocked.closed_at.is_none());

    // 导出 handover.zip。
    let path = handover::export_handover(&s, &t.id, None).unwrap();
    assert!(path.exists(), "handover.zip 应落盘");

    // 生成接手 Prompt,断言自给自足。
    let settings = s.settings_snapshot();
    let prompt = engine_handover::generate_handover_prompt(&s.db, &t.id, &settings).unwrap();

    assert!(prompt.contains("实现登录模块"), "含任务标题");
    assert!(prompt.contains("JWT"), "含此前的关键决策");
    assert!(
        prompt.contains("无状态") || prompt.contains("水平扩展"),
        "含决策理由"
    );
    assert!(prompt.contains("401"), "含此前踩的坑");
    assert!(prompt.contains("初始化顺序"), "含坑的处理方式");
    assert!(
        prompt.contains("feat/auth") && prompt.contains("9a8b7c"),
        "含仓库对齐信息"
    );
    assert!(prompt.contains("你的下一步"), "含给接手者的指引");
    // 接手者读这一段即可继续,无需额外口头解释。
    assert!(prompt.len() > 200);
}
