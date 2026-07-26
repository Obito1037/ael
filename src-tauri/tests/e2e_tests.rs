//! 端到端链路测试:adapter 落库 → finalize 提炼 → Failure Guard 命中 → handover 导出。
//! 对应验收「从操作一直到 SQLite 落库、handover.zip 导出,全链路无断点」。

mod common;

use ael_lib::engine::{finalize, guard};
use ael_lib::models::{NewTask, SkillStatus, TaskStatus};
use ael_lib::{adapter, handover};

const AGENT_OUTPUT: &str = "\
step: 初始化 Tauri 2 项目
step: 配置 Cargo 依赖
error: linker `link.exe` not found :: Windows 缺少 VS C++ 工具链
fix: 安装 VS Build Tools 并勾选 Desktop development with C++
verify: pnpm tauri build 产出 .msi ✅";

fn make_task(s: &ael_lib::state::AppState, title: &str) -> String {
    s.db.create_task(NewTask {
        title: title.into(),
        goal: "在 Windows 上首次构建 Tauri 2 桌面应用".into(),
        agent_id: Some("claude_code".into()),
        repo_path: Some("D:/repo".into()),
        repo_branch: Some("main".into()),
        repo_commit: Some("abc".into()),
        tags: vec!["tauri".into(), "windows".into(), "build".into()],
    })
    .unwrap()
    .id
}

#[test]
fn full_chain_no_breakpoints() {
    let s = common::temp_state();

    // 1) 任务 + 通过 adapter 把 Agent 输出落成证据链(SQLite)
    let id = make_task(&s, "构建 Tauri 应用 (首次)");
    let events = adapter::ingest(&s.db, &id, "claude_code", AGENT_OUTPUT).unwrap();
    assert_eq!(events.len(), 5, "5 行输出 → 5 条证据事件");
    assert_eq!(s.db.list_events(&id).unwrap().len(), 5);

    // 2) 任务通过验证 → finalize 提炼经验
    s.db.update_task_status(&id, TaskStatus::Verified).unwrap();
    let result = finalize::finalize_task(&s.db, &id).unwrap();
    assert!(
        !result.draft_skills.is_empty(),
        "verified 任务应产出 draft Skill"
    );
    assert!(
        !result.draft_failures.is_empty(),
        "error→fix 应产出 draft Failure"
    );
    assert_eq!(result.draft_skills[0].status, SkillStatus::Draft);

    // 3) 人工确认:把草案转 active(模拟 GUI 审核)
    let skill_id = result.draft_skills[0].id.clone();
    s.db.update_skill_status(&skill_id, SkillStatus::Active)
        .unwrap();

    // 4) 一个相似的新任务:Failure Guard 应命中历史失败 + 推荐 Skill
    let settings = s.settings_snapshot();
    let g = guard::check_failure_guard(
        &s.db,
        "重新在 Windows 上构建 Tauri 应用",
        &["tauri".into(), "windows".into(), "build".into()],
        &settings,
    )
    .unwrap();
    assert!(!g.matched_failures.is_empty(), "相似任务应命中历史失败");
    assert!(!g.constraints.is_empty(), "应注入约束(来自 guard_rule)");
    assert!(!g.suggested_skills.is_empty(), "应推荐已 active 的 Skill");
    assert!(!g.handover_prompt.is_empty());

    // 5) 不相关的任务:阈值护栏应过滤掉,不误注入
    let g2 = guard::check_failure_guard(
        &s.db,
        "用 Python 写一个 CSV 解析脚本",
        &["python".into(), "csv".into()],
        &settings,
    )
    .unwrap();
    assert!(
        g2.matched_failures.is_empty(),
        "不相关任务不应命中(护栏生效)"
    );

    // 6) 导出 handover.zip — 链路终点
    let new_id = make_task(&s, "继续构建任务 (交接)");
    let path = handover::export_handover(&s, &new_id, None).unwrap();
    assert!(path.exists(), "handover.zip 应成功落盘");
}
