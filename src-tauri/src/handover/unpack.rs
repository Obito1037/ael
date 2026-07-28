//! ★ Codex 地盘 —— handover.zip → 导入本地库(参考实现)。
//! 解析 manifest.json,在本地以新 id 重建 task + 证据链,返回新 taskId。

use super::schema::Manifest;
use crate::error::{AelError, AelResult};
use crate::models::{EventKind, NewEvent, NewTask, TaskStatus};
use crate::state::AppState;
use std::io::Read;
use std::path::Path;

pub fn import_handover(state: &AppState, path: &str) -> AelResult<String> {
    let manifest = read_manifest(Path::new(path))?;

    // 以新 id 落地,避免与本地既有 task 冲突。
    let task = state.db.create_task(NewTask {
        title: manifest.task.title.clone(),
        goal: manifest.task.goal.clone(),
        agent_id: manifest.task.agent_id.clone(),
        repo_path: manifest
            .task
            .repo_state
            .as_ref()
            .and_then(|r| r.path.clone()),
        repo_branch: manifest
            .task
            .repo_state
            .as_ref()
            .and_then(|r| r.branch.clone()),
        repo_commit: manifest
            .task
            .repo_state
            .as_ref()
            .and_then(|r| r.commit.clone()),
        tags: manifest.task.tags.clone(),
    })?;

    // 按 seq 升序回放证据链(seq 由本地重新分配,保持相对顺序)。
    let mut events = manifest.events.clone();
    events.sort_by_key(|e| e.seq);
    for e in &events {
        let kind = EventKind::from_db(&e.kind)?;
        state.db.append_event(NewEvent::basic(
            task.id.clone(),
            kind,
            e.summary.clone(),
            e.detail.clone(),
            e.evidence_ref.clone(),
        ))?;
    }

    // 对齐导入时的状态。
    if let Ok(status) = TaskStatus::from_db(&manifest.task.status) {
        let _ = state.db.update_task_status(&task.id, status);
    }

    Ok(task.id)
}

fn read_manifest(path: &Path) -> AelResult<Manifest> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut entry = archive
        .by_name("manifest.json")
        .map_err(|_| AelError::invalid_input("handover.zip 缺少 manifest.json"))?;
    let mut text = String::new();
    entry.read_to_string(&mut text)?;
    let manifest: Manifest = serde_json::from_str(&text)
        .map_err(|e| AelError::invalid_input(format!("manifest.json 解析失败: {e}")))?;
    Ok(manifest)
}
