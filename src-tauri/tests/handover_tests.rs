//! 接手包测试(Codex handover 模块):pack 落盘 + 往返无损。

mod common;

use ael_lib::handover::{export_handover, import_handover};
use ael_lib::models::{EventKind, NewEvent, NewTask, TaskStatus};
use std::io::Read;

fn seed(s: &ael_lib::state::AppState) -> String {
    let t =
        s.db.create_task(NewTask {
            title: "Tauri 构建".into(),
            goal: "Windows 首次构建 Tauri 2".into(),
            agent_id: Some("claude_code".into()),
            repo_path: Some("D:/repo".into()),
            repo_branch: Some("main".into()),
            repo_commit: Some("c0ffee".into()),
            tags: vec!["tauri".into(), "windows".into(), "build".into()],
        })
        .unwrap();
    for (kind, sum) in [
        (EventKind::Step, "安装依赖"),
        (EventKind::Error, "link.exe not found"),
        (EventKind::Fix, "安装 VS Build Tools"),
        (EventKind::Verification, "产出 .msi"),
    ] {
        s.db.append_event(NewEvent {
            task_id: t.id.clone(),
            kind,
            summary: sum.into(),
            detail: None,
            evidence_ref: None,
        })
        .unwrap();
    }
    s.db.update_task_status(&t.id, TaskStatus::Verified)
        .unwrap();
    t.id
}

#[test]
fn export_writes_zip_with_manifest_and_prompt() {
    let s = common::temp_state();
    let id = seed(&s);
    let path = export_handover(&s, &id, None).unwrap();
    assert!(path.exists(), "handover.zip 应落盘");

    let file = std::fs::File::open(&path).unwrap();
    let mut zip = zip::ZipArchive::new(file).unwrap();
    let names: Vec<String> = (0..zip.len())
        .map(|i| zip.by_index(i).unwrap().name().to_string())
        .collect();
    assert!(names.iter().any(|n| n == "manifest.json"));
    assert!(names.iter().any(|n| n == "handover_prompt.md"));

    let mut text = String::new();
    zip.by_name("manifest.json")
        .unwrap()
        .read_to_string(&mut text)
        .unwrap();
    let manifest: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(manifest["schema_version"], 1);
    assert_eq!(manifest["events"].as_array().unwrap().len(), 4);
    assert!(!manifest["handover_prompt"].as_str().unwrap().is_empty());
    assert_eq!(manifest["task"]["status"], "verified");
}

#[test]
fn pack_then_unpack_roundtrip_preserves_events() {
    let s = common::temp_state();
    let id = seed(&s);
    let path = export_handover(&s, &id, None).unwrap();

    let new_id = import_handover(&s, path.to_str().unwrap()).unwrap();
    assert_ne!(new_id, id, "导入应以新 id 落地");

    let orig = s.db.list_events(&id).unwrap();
    let imported = s.db.list_events(&new_id).unwrap();
    assert_eq!(orig.len(), imported.len(), "事件数往返无损");
    assert_eq!(imported[0].seq, 1, "导入后 seq 重新分配且连续");

    let task = s.db.get_task(&new_id).unwrap();
    assert_eq!(task.status, TaskStatus::Verified, "状态对齐");
    assert_eq!(task.tags.len(), 3, "标签往返无损");
}
