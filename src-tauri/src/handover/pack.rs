//! ★ Codex 地盘 —— task → handover.zip 打包(参考实现)。
//! zip 布局见 contracts/handover-schema.json $zip_layout:
//!   manifest.json / handover_prompt.md / evidence/

use super::schema::{
    Manifest, ManifestEvent, ManifestOrigin, ManifestTask, AHP_VERSION, HANDOVER_SCHEMA_VERSION,
};
use crate::engine::{brief, handover as engine_handover, search};
use crate::error::AelResult;
use crate::models::{HandoverInclude, Settings, Skill};
use crate::state::AppState;
use crate::util::now_iso;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::FileOptions;

const RELATED_LIMIT: i64 = 8;

pub fn export_handover(
    state: &AppState,
    task_id: &str,
    include: Option<HandoverInclude>,
) -> AelResult<PathBuf> {
    let settings = state.settings_snapshot();
    let mut manifest = build_manifest(state, task_id, include.unwrap_or_default(), &settings)?;
    // 出口①的一页证据随包携带(AHP)。
    let brief_md = brief::compile(&state.db, task_id).map(|b| b.markdown).ok();
    manifest.brief_path = brief_md.as_ref().map(|_| "brief.md".to_string());
    let evidence_files = collect_evidence_files(&mut manifest);
    let skill_candidates = state.db.list_skill_candidates(None, 500)?;
    let failure_candidates = state.db.list_failure_candidates(None, 500)?;

    let dest = state.db.paths.handovers.join(format!("{task_id}.zip"));
    let file = std::fs::File::create(&dest)?;
    let mut zip = zip::ZipWriter::new(file);
    // zip 0.6:FileOptions 非泛型。
    let opts = FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    zip.start_file("manifest.json", opts)?;
    zip.write_all(manifest_json.as_bytes())?;

    zip.start_file("handover_prompt.md", opts)?;
    zip.write_all(manifest.handover_prompt.as_bytes())?;

    // v2 portable layout:保留旧文件名，同时提供不依赖 AEL 内部结构的标准入口。
    zip.start_file("HANDOVER.md", opts)?;
    zip.write_all(manifest.handover_prompt.as_bytes())?;

    zip.start_file("evidence.jsonl", opts)?;
    for event in &manifest.events {
        zip.write_all(serde_json::to_string(event)?.as_bytes())?;
        zip.write_all(b"\n")?;
    }

    zip.start_file("failures.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&manifest.relevant_failures)?.as_bytes())?;

    let repo = serde_json::json!({
        "path": manifest.repo_path.as_deref(),
        "branch": manifest.repo_branch.as_deref(),
        "commit": manifest.repo_commit.as_deref(),
    });
    zip.start_file("repo.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&repo)?.as_bytes())?;

    let verification_events: Vec<&ManifestEvent> = manifest
        .events
        .iter()
        .filter(|event| event.kind == "verification")
        .collect();
    let verification = serde_json::json!({
        "task_id": &manifest.task_id,
        "status": &manifest.task.status,
        "verified": manifest.task.status == "verified",
        "verification_event_count": verification_events.len(),
        "error_event_count": manifest.events.iter().filter(|event| event.kind == "error").count(),
        "events": verification_events,
    });
    zip.start_file("verification.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&verification)?.as_bytes())?;

    if let Some(md) = &brief_md {
        zip.start_file("brief.md", opts)?;
        zip.write_all(md.as_bytes())?;
    }

    zip.add_directory("evidence/", opts)?;
    for (archive_path, bytes) in evidence_files {
        zip.start_file(archive_path, opts)?;
        zip.write_all(&bytes)?;
    }

    zip.add_directory("skills/", opts)?;
    for (index, value) in manifest.relevant_skills.iter().enumerate() {
        let Ok(skill) = serde_json::from_value::<Skill>(value.clone()) else {
            continue;
        };
        let folder = format!("skills/{:02}-{}", index + 1, safe_slug(&skill.id));
        zip.add_directory(format!("{folder}/"), opts)?;
        zip.start_file(format!("{folder}/SKILL.md"), opts)?;
        zip.write_all(skill_markdown(&skill).as_bytes())?;
    }

    // 候选以独立 JSON 文件随包携带，便于接手方审阅；不把候选直接当成 active 记忆。
    zip.add_directory("candidates/", opts)?;
    zip.start_file("candidates/skill_candidates.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&skill_candidates)?.as_bytes())?;
    zip.start_file("candidates/failure_candidates.json", opts)?;
    zip.write_all(serde_json::to_string_pretty(&failure_candidates)?.as_bytes())?;

    zip.finish()?;
    Ok(dest)
}

fn safe_slug(value: &str) -> String {
    let mut slug = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    while slug.contains("--") {
        slug = slug.replace("--", "-");
    }
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        "skill".into()
    } else {
        slug
    }
}

fn skill_markdown(skill: &Skill) -> String {
    let description = skill
        .trigger
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "---\nname: {}\ndescription: {}\n---\n\n# {}\n\n{}\n\n## Tags\n{}\n\n## Provenance\n- skill_id: {}\n- status: {:?}\n",
        safe_slug(&skill.id),
        description.replace(['\n', '\r'], " "),
        skill.name,
        skill.body,
        if skill.tags.is_empty() { "（无）".into() } else { skill.tags.join(", ") },
        skill.id,
        skill.status,
    )
}

/// 将事件 evidence_ref 指向的本地文件复制进包，并把引用改写为包内相对路径。
/// 不读取目录、不跟随通配符；不存在或不可读的引用保留原值，避免静默伪造证据。
fn collect_evidence_files(manifest: &mut Manifest) -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();
    for (index, event) in manifest.events.iter_mut().enumerate() {
        let Some(reference) = event.evidence_ref.clone() else {
            continue;
        };
        let path = Path::new(&reference);
        if !path.is_file() {
            continue;
        }
        let Some(file_name) = path.file_name().and_then(|name| name.to_str()) else {
            continue;
        };
        let safe_name = file_name.replace(['\\', '/'], "_");
        let archive_path = format!("evidence/{index:04}-{safe_name}");
        let Ok(bytes) = std::fs::read(path) else {
            continue;
        };
        event.evidence_ref = Some(archive_path.clone());
        files.push((archive_path, bytes));
    }
    files
}

pub fn build_manifest(
    state: &AppState,
    task_id: &str,
    include: HandoverInclude,
    settings: &Settings,
) -> AelResult<Manifest> {
    let db = &state.db;
    let task = db.get_task(task_id)?;

    let events_objs: Vec<ManifestEvent> = if include.events.unwrap_or(true) {
        db.list_events(task_id)?
            .iter()
            .map(ManifestEvent::from_event)
            .collect()
    } else {
        Vec::new()
    };

    let relevant_skills = if include.skills.unwrap_or(true) {
        search::suggested_skills(
            db,
            &task.goal,
            &task.tags,
            RELATED_LIMIT,
            settings.guard_min_score,
        )?
        .iter()
        .map(|s| serde_json::to_value(s).unwrap_or(serde_json::Value::Null))
        .collect()
    } else {
        Vec::new()
    };

    let relevant_failures = if include.failures.unwrap_or(true) {
        search::matched_failures(
            db,
            &task.goal,
            &task.tags,
            RELATED_LIMIT,
            settings.guard_min_score,
        )?
        .iter()
        .map(|f| serde_json::to_value(f).unwrap_or(serde_json::Value::Null))
        .collect()
    } else {
        Vec::new()
    };

    let handover_prompt = engine_handover::generate_handover_prompt(db, task_id, settings)?;

    // v2:随包携带治理产物(ADR + 海关裁决账本)。
    let adrs = db
        .list_adrs(Some(task_id))?
        .iter()
        .map(|a| serde_json::to_value(a).unwrap_or(serde_json::Value::Null))
        .collect();
    let policy_decisions = db
        .list_policy_decisions(None, Some(task_id), 500, 0)?
        .iter()
        .map(|d| serde_json::to_value(d).unwrap_or(serde_json::Value::Null))
        .collect();

    let sessions = db.list_agent_sessions(Some(task_id.to_string()), None)?;
    let mut source_agents = Vec::new();
    let mut source_sessions = Vec::new();
    if let Some(agent) = task.agent_id.as_deref() {
        source_agents.push(agent.to_string());
    }
    for session in sessions {
        if !source_agents.contains(&session.agent_id) {
            source_agents.push(session.agent_id);
        }
        source_sessions.push(session.id);
    }

    Ok(Manifest {
        schema_version: HANDOVER_SCHEMA_VERSION,
        ahp_version: Some(AHP_VERSION.to_string()),
        generated_at: now_iso(),
        generated_by: task.agent_id.clone(),
        ael_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        task_id: task.id.clone(),
        title: task.title.clone(),
        goal: task.goal.clone(),
        repo_path: task.repo_path.clone(),
        repo_branch: task.repo_branch.clone(),
        repo_commit: task.repo_commit.clone(),
        source_agents,
        source_sessions,
        origin: Some(ManifestOrigin {
            agent: task.agent_id.clone(),
            model: None,
        }),
        task: ManifestTask::from_task(&task),
        events: events_objs,
        relevant_skills,
        relevant_failures,
        adrs,
        policy_decisions,
        brief_path: Some("brief.md".to_string()),
        open_questions: include.open_questions.unwrap_or_default(),
        handover_prompt,
    })
}
