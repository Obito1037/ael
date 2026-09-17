//! ★ Codex 地盘 —— handover.zip → 导入本地库(参考实现)。
//! 解析 manifest.json,在本地以新 id 重建 task + 证据链,返回新 taskId。

use super::schema::{Manifest, HANDOVER_SCHEMA_VERSION};
use crate::engine::normalize;
use crate::error::{AelError, AelResult};
use crate::models::{
    AdrRecord, EventActor, EventKind, Failure, NewAdr, NewEvent, NewFailure, NewPolicyDecision,
    NewSkill, NewTask, PolicyDecision, Skill, SkillStatus, TaskStatus,
};
use crate::state::AppState;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;

const MAX_MANIFEST_BYTES: u64 = 2 * 1024 * 1024;
const MAX_EVIDENCE_FILES: usize = 128;
const MAX_EVIDENCE_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_EVIDENCE_TOTAL_BYTES: u64 = 128 * 1024 * 1024;

pub fn import_handover(state: &AppState, path: &str) -> AelResult<String> {
    let (manifest, evidence) = read_archive(Path::new(path))?;
    if manifest.schema_version > HANDOVER_SCHEMA_VERSION {
        return Err(AelError::invalid_input(format!(
            "handover schema_version {} 高于当前支持版本 {}",
            manifest.schema_version, HANDOVER_SCHEMA_VERSION
        )));
    }

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
    let evidence_dir = state.db.paths.root.join("imported-evidence").join(&task.id);
    let mut events = manifest.events.clone();
    events.sort_by_key(|e| e.seq);
    for e in &events {
        let kind = EventKind::from_db(&e.kind)?;
        let evidence_ref =
            materialize_evidence(&evidence, e.evidence_ref.as_deref(), &evidence_dir)?;
        state.db.append_event(NewEvent {
            task_id: task.id.clone(),
            kind,
            summary: e.summary.clone(),
            detail: e.detail.clone(),
            evidence_ref,
            actor: e.actor.unwrap_or(EventActor::Ai),
            session_id: e.session_id.clone(),
            anchor_file: e.anchor_file.clone(),
            anchor_lines: e.anchor_lines.clone(),
        })?;
    }

    let skipped_artifacts = import_skills(&state.db, &manifest, &task.id)
        + import_failures(&state.db, &manifest, &task.id)
        + import_adrs(&state.db, &manifest, &task.id)
        + import_policy_decisions(&state.db, &manifest, &task.id);
    if skipped_artifacts > 0 {
        let _ = state.db.append_event(NewEvent::basic(
            task.id.clone(),
            EventKind::Note,
            "交接包导入存在未导入的可选产物",
            Some(format!(
                "共有 {skipped_artifacts} 项 Skill/Failure/ADR/策略记录格式错误或写入失败，已保留主任务与证据链。"
            )),
            None,
        ));
    }

    // 对齐导入时的状态。
    if let Ok(status) = TaskStatus::from_db(&manifest.task.status) {
        let _ = state.db.update_task_status(&task.id, status);
    }

    Ok(task.id)
}

fn read_archive(path: &Path) -> AelResult<(Manifest, HashMap<String, Vec<u8>>)> {
    let file = std::fs::File::open(path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut entry = archive
        .by_name("manifest.json")
        .map_err(|_| AelError::invalid_input("handover.zip 缺少 manifest.json"))?;
    if entry.size() > MAX_MANIFEST_BYTES {
        return Err(AelError::invalid_input("manifest.json 超过 2 MiB 限制"));
    }
    let mut text = String::new();
    entry.read_to_string(&mut text)?;
    let manifest: Manifest = serde_json::from_str(&text)
        .map_err(|e| AelError::invalid_input(format!("manifest.json 解析失败: {e}")))?;
    drop(entry);

    let mut evidence = HashMap::new();
    let mut total_evidence_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut item = archive.by_index(index)?;
        let name = item.name().to_string();
        if !name.starts_with("evidence/") || name.ends_with('/') {
            continue;
        }
        let safe_name = Path::new(&name)
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| AelError::invalid_input("evidence 文件名非法"))?;
        if safe_name.is_empty() || safe_name == "." || safe_name == ".." {
            return Err(AelError::invalid_input("evidence 文件名非法"));
        }
        if evidence.len() >= MAX_EVIDENCE_FILES {
            return Err(AelError::invalid_input(
                "handover evidence 文件数量超过限制",
            ));
        }
        if item.size() > MAX_EVIDENCE_FILE_BYTES {
            return Err(AelError::invalid_input(
                "单个 evidence 文件超过 32 MiB 限制",
            ));
        }
        total_evidence_bytes = total_evidence_bytes.saturating_add(item.size());
        if total_evidence_bytes > MAX_EVIDENCE_TOTAL_BYTES {
            return Err(AelError::invalid_input(
                "handover evidence 总大小超过 128 MiB 限制",
            ));
        }
        let mut bytes = Vec::new();
        item.read_to_end(&mut bytes)?;
        evidence.insert(name, bytes);
    }
    Ok((manifest, evidence))
}

fn materialize_evidence(
    evidence: &HashMap<String, Vec<u8>>,
    reference: Option<&str>,
    root: &Path,
) -> AelResult<Option<String>> {
    let Some(reference) = reference else {
        return Ok(None);
    };
    let Some(bytes) = evidence.get(reference) else {
        // 不把导出端的绝对路径带入当前机器，避免产生误导性或越权的本地引用。
        return Ok(None);
    };
    let Some(name) = Path::new(reference).file_name().and_then(|n| n.to_str()) else {
        return Ok(None);
    };
    std::fs::create_dir_all(root)?;
    let dest = root.join(name);
    std::fs::write(&dest, bytes)?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

fn import_skills(db: &crate::db::Db, manifest: &Manifest, task_id: &str) -> usize {
    let mut skipped = 0;
    let existing = db.list_skills(None, 1_000, 0).unwrap_or_default();
    let mut imported = std::collections::HashSet::new();
    for value in &manifest.relevant_skills {
        let Ok(skill) = serde_json::from_value::<Skill>(value.clone()) else {
            skipped += 1;
            continue;
        };
        let fingerprint = format!("{}\n{}\n{}", skill.name, skill.trigger, skill.body);
        if !imported.insert(fingerprint.clone())
            || existing.iter().any(|item| {
                format!("{}\n{}\n{}", item.name, item.trigger, item.body) == fingerprint
            })
        {
            continue;
        }
        // 外部包中的经验必须经过本地确认，不能直接获得 active 召回权。
        if db
            .create_skill(NewSkill {
                name: skill.name,
                trigger: skill.trigger,
                body: skill.body,
                tags: skill.tags,
                source_task_id: Some(task_id.to_string()),
                status: SkillStatus::Draft,
                origin_agent: skill.origin_agent,
                origin_model: skill.origin_model,
            })
            .is_err()
        {
            skipped += 1;
        }
    }
    skipped
}

fn import_failures(db: &crate::db::Db, manifest: &Manifest, task_id: &str) -> usize {
    let mut skipped = 0;
    for value in &manifest.relevant_failures {
        let Ok(failure) = serde_json::from_value::<Failure>(value.clone()) else {
            skipped += 1;
            continue;
        };
        let source = match &failure.root_cause {
            Some(root) if !root.trim().is_empty() => format!("{}\n{}", failure.description, root),
            _ => failure.description.clone(),
        };
        let (normalized_text, derived_signature) = normalize::normalize_and_sign(&source);
        let signature = if failure.signature.trim().is_empty() {
            derived_signature
        } else {
            failure.signature.clone()
        };
        let occurrences = failure.occurrences.max(1);
        if let Ok(Some(existing)) = db.find_failure_by_signature(&signature) {
            // Failure 是全局记忆，重复导入只增加证据次数，避免污染召回库。
            for _ in 0..occurrences {
                let _ = db.bump_failure(&existing.id);
            }
            continue;
        }
        let Ok(inserted) = db.insert_failure(NewFailure {
            task_id: Some(task_id.to_string()),
            source_event_id: None,
            signature,
            normalized_text,
            description: failure.description,
            root_cause: failure.root_cause,
            fix: failure.fix,
            guard_rule: failure.guard_rule,
            tags: failure.tags,
            origin_agent: failure.origin_agent,
            origin_model: failure.origin_model,
        }) else {
            skipped += 1;
            continue;
        };
        for _ in 1..occurrences {
            let _ = db.bump_failure(&inserted.id);
        }
    }
    skipped
}

fn import_adrs(db: &crate::db::Db, manifest: &Manifest, task_id: &str) -> usize {
    let mut skipped = 0;
    for value in &manifest.adrs {
        let Ok(adr) = serde_json::from_value::<AdrRecord>(value.clone()) else {
            skipped += 1;
            continue;
        };
        if db
            .insert_adr(NewAdr {
                task_id: Some(task_id.to_string()),
                title: adr.title,
                status: adr.status,
                context: adr.context,
                decision: adr.decision,
                consequences: adr.consequences,
                source_event_id: None,
                file_path: adr.file_path,
            })
            .is_err()
        {
            skipped += 1;
        }
    }
    skipped
}

fn import_policy_decisions(db: &crate::db::Db, manifest: &Manifest, task_id: &str) -> usize {
    let mut skipped = 0;
    for value in &manifest.policy_decisions {
        let Ok(decision) = serde_json::from_value::<PolicyDecision>(value.clone()) else {
            skipped += 1;
            continue;
        };
        if db
            .insert_policy_decision(NewPolicyDecision {
                session_id: None,
                task_id: Some(task_id.to_string()),
                rule_id: decision.rule_id,
                action: decision.action,
                verdict: decision.verdict,
                command_text: decision.command_text,
                reason: decision.reason,
                decided_by: decision.decided_by,
                resolved_at: decision.resolved_at,
            })
            .is_err()
        {
            skipped += 1;
        }
    }
    skipped
}
