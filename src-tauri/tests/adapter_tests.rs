//! 适配层测试(Codex adapter 模块)。验证归一化分类 + 写入证据链。

mod common;

use ael_lib::adapter;
use ael_lib::models::{EventKind, NewTask};

fn new_task(s: &ael_lib::state::AppState) -> String {
    s.db.create_task(NewTask {
        title: "t".into(),
        goal: "g".into(),
        agent_id: Some("claude_code".into()),
        repo_path: None,
        repo_branch: None,
        repo_commit: None,
        tags: vec![],
    })
    .unwrap()
    .id
}

const RAW: &str = "\
step: 安装依赖
error: linker `link.exe` not found :: 缺少 VS C++ 工具链
fix: 安装 VS Build Tools 后重试
verify: tauri build 产出 .msi ✅
decision: 选用 rusqlite bundled :: 免装系统 sqlite";

#[test]
fn claude_code_adapter_classifies_and_writes() {
    let s = common::temp_state();
    let id = new_task(&s);
    let written = adapter::ingest(&s.db, &id, "claude_code", None, RAW).unwrap();
    assert_eq!(written.len(), 5);

    let kinds: Vec<EventKind> = written.iter().map(|e| e.kind).collect();
    assert_eq!(kinds[0], EventKind::Step);
    assert_eq!(kinds[1], EventKind::Error);
    assert_eq!(kinds[2], EventKind::Fix);
    assert_eq!(kinds[3], EventKind::Verification);
    assert_eq!(kinds[4], EventKind::Decision);

    // `::` 之后进 detail
    assert_eq!(written[1].detail.as_deref(), Some("缺少 VS C++ 工具链"));
    // seq 连续
    assert_eq!(written[0].seq, 1);
    assert_eq!(written[4].seq, 5);
}

#[test]
fn codex_adapter_and_unknown_fallback() {
    let s = common::temp_state();
    let id = new_task(&s);
    let a = adapter::ingest(&s.db, &id, "codex", None, "step: a\nerror: boom").unwrap();
    assert_eq!(a.len(), 2);
    assert_eq!(a[1].kind, EventKind::Error);

    // 未知来源回退到通用解析,不报错
    let id2 = new_task(&s);
    let b = adapter::ingest(&s.db, &id2, "mystery-agent", None, "note: hi").unwrap();
    assert_eq!(b.len(), 1);
    assert_eq!(b[0].kind, EventKind::Note);
}
