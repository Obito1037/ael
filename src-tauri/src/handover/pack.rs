//! ★ Codex 地盘 —— task → handover.zip 打包(参考实现)。
//! zip 布局见 contracts/handover-schema.json $zip_layout:
//!   manifest.json / handover_prompt.md / evidence/

use super::schema::{Manifest, ManifestEvent, ManifestTask, HANDOVER_SCHEMA_VERSION};
use crate::engine::{handover as engine_handover, search};
use crate::error::AelResult;
use crate::models::{HandoverInclude, Settings};
use crate::state::AppState;
use crate::util::now_iso;
use std::io::Write;
use std::path::PathBuf;
use zip::write::FileOptions;

const RELATED_LIMIT: i64 = 8;

pub fn export_handover(
    state: &AppState,
    task_id: &str,
    include: Option<HandoverInclude>,
) -> AelResult<PathBuf> {
    let settings = state.settings_snapshot();
    let manifest = build_manifest(state, task_id, include.unwrap_or_default(), &settings)?;

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

    // evidence/ 目录占位(实际证据文件拷贝留待 Codex 按 evidence_ref 实现)。
    zip.add_directory("evidence/", opts)?;

    zip.finish()?;
    Ok(dest)
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

    Ok(Manifest {
        schema_version: HANDOVER_SCHEMA_VERSION,
        generated_at: now_iso(),
        generated_by: task.agent_id.clone(),
        ael_version: Some(env!("CARGO_PKG_VERSION").to_string()),
        task: ManifestTask::from_task(&task),
        events: events_objs,
        relevant_skills,
        relevant_failures,
        open_questions: include.open_questions.unwrap_or_default(),
        handover_prompt,
    })
}
