//! Fixed-target agent config/context file sync.
//!
//! The frontend never supplies arbitrary filesystem paths here. It can only pick
//! from known Codex/Claude/Gemini/OpenCode global config files and per-project
//! context files, which keeps this surface predictable enough for automation.

use crate::db::init::atomic_write;
use crate::error::{AelError, AelResult};
use crate::util::new_id;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_CONFIG_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentConfigTargetType {
    NativeConfig,
    ProjectContext,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentConfigFormat {
    Json,
    Toml,
    Markdown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigTarget {
    pub id: String,
    pub agent_id: String,
    pub target_type: AgentConfigTargetType,
    pub format: AgentConfigFormat,
    pub path: String,
    pub exists: bool,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigContent {
    pub target: AgentConfigTarget,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConfigWriteResult {
    pub target: AgentConfigTarget,
    pub backup_path: Option<String>,
    pub bytes_written: usize,
}

#[derive(Clone, Copy)]
struct TargetSpec {
    id: &'static str,
    agent_id: &'static str,
    target_type: AgentConfigTargetType,
    format: AgentConfigFormat,
    description: &'static str,
    path_kind: PathKind,
}

#[derive(Clone, Copy)]
enum PathKind {
    Home(&'static [&'static str]),
    AppDataOrHome(&'static [&'static str], &'static [&'static str]),
    Project(&'static str),
}

pub fn list_config_targets(cwd: Option<String>) -> AelResult<Vec<AgentConfigTarget>> {
    list_config_targets_with_home(cwd, None)
}

pub fn read_config_target(target_id: &str, cwd: Option<String>) -> AelResult<AgentConfigContent> {
    read_config_target_with_home(target_id, cwd, None)
}

pub fn write_config_target(
    target_id: &str,
    cwd: Option<String>,
    content: String,
    create_backup: bool,
    backup_root: &Path,
) -> AelResult<AgentConfigWriteResult> {
    write_config_target_with_home(target_id, cwd, content, create_backup, backup_root, None)
}

pub fn backup_config_target(
    target_id: &str,
    cwd: Option<String>,
    backup_root: &Path,
) -> AelResult<Option<String>> {
    let target = resolve_target(target_id, cwd, None)?;
    backup_existing_file(&target, backup_root)
}

pub fn list_config_targets_with_home(
    cwd: Option<String>,
    home_override: Option<PathBuf>,
) -> AelResult<Vec<AgentConfigTarget>> {
    specs()
        .iter()
        .map(|spec| target_from_spec(*spec, cwd.as_deref(), home_override.as_deref()))
        .collect()
}

pub fn read_config_target_with_home(
    target_id: &str,
    cwd: Option<String>,
    home_override: Option<PathBuf>,
) -> AelResult<AgentConfigContent> {
    let target = resolve_target_with_home(target_id, cwd, home_override)?;
    let path = PathBuf::from(&target.path);
    let content = if path.exists() {
        let bytes = fs::read(&path)?;
        if bytes.len() > MAX_CONFIG_BYTES {
            return Err(AelError::invalid_input(format!(
                "config file exceeds {MAX_CONFIG_BYTES} bytes: {}",
                target.path
            )));
        }
        String::from_utf8(bytes)
            .map_err(|e| AelError::invalid_input(format!("config file is not UTF-8: {e}")))?
    } else {
        String::new()
    };
    Ok(AgentConfigContent { target, content })
}

pub fn write_config_target_with_home(
    target_id: &str,
    cwd: Option<String>,
    content: String,
    create_backup: bool,
    backup_root: &Path,
    home_override: Option<PathBuf>,
) -> AelResult<AgentConfigWriteResult> {
    if content.len() > MAX_CONFIG_BYTES {
        return Err(AelError::invalid_input(format!(
            "config content exceeds {MAX_CONFIG_BYTES} bytes"
        )));
    }

    let mut target = resolve_target_with_home(target_id, cwd, home_override)?;
    let backup_path = if create_backup {
        backup_existing_file(&target, backup_root)?
    } else {
        None
    };
    atomic_write(Path::new(&target.path), content.as_bytes())?;
    target.exists = true;
    Ok(AgentConfigWriteResult {
        target,
        backup_path,
        bytes_written: content.len(),
    })
}

fn resolve_target(
    target_id: &str,
    cwd: Option<String>,
    home_override: Option<PathBuf>,
) -> AelResult<AgentConfigTarget> {
    resolve_target_with_home(target_id, cwd, home_override)
}

fn resolve_target_with_home(
    target_id: &str,
    cwd: Option<String>,
    home_override: Option<PathBuf>,
) -> AelResult<AgentConfigTarget> {
    let spec = specs()
        .into_iter()
        .find(|spec| spec.id == target_id)
        .ok_or_else(|| AelError::invalid_input(format!("unknown config target: {target_id}")))?;
    target_from_spec(spec, cwd.as_deref(), home_override.as_deref())
}

fn target_from_spec(
    spec: TargetSpec,
    cwd: Option<&str>,
    home_override: Option<&Path>,
) -> AelResult<AgentConfigTarget> {
    let path = match spec.path_kind {
        PathKind::Home(parts) => join(home_dir(home_override)?, parts),
        PathKind::AppDataOrHome(appdata_parts, home_parts) => {
            if home_override.is_none() {
                if let Some(appdata) = std::env::var_os("APPDATA") {
                    join(PathBuf::from(appdata), appdata_parts)
                } else {
                    join(home_dir(home_override)?, home_parts)
                }
            } else {
                join(home_dir(home_override)?, home_parts)
            }
        }
        PathKind::Project(file_name) => project_cwd(cwd)?.join(file_name),
    };

    Ok(AgentConfigTarget {
        id: spec.id.to_string(),
        agent_id: spec.agent_id.to_string(),
        target_type: spec.target_type,
        format: spec.format,
        exists: path.exists(),
        path: path.to_string_lossy().to_string(),
        description: spec.description.to_string(),
    })
}

fn backup_existing_file(
    target: &AgentConfigTarget,
    backup_root: &Path,
) -> AelResult<Option<String>> {
    let path = PathBuf::from(&target.path);
    if !path.exists() {
        return Ok(None);
    }

    let backup_dir = backup_root.join("config");
    fs::create_dir_all(&backup_dir)?;
    let filename = format!(
        "{}-{}-{}.bak",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
        safe_segment(&target.id),
        new_id().split('-').next().unwrap_or("0")
    );
    let dest = backup_dir.join(filename);
    fs::copy(&path, &dest)?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

fn specs() -> Vec<TargetSpec> {
    vec![
        TargetSpec {
            id: "codex_global",
            agent_id: "codex",
            target_type: AgentConfigTargetType::NativeConfig,
            format: AgentConfigFormat::Toml,
            description: "Codex global config.toml",
            path_kind: PathKind::Home(&[".codex", "config.toml"]),
        },
        TargetSpec {
            id: "codex_project",
            agent_id: "codex",
            target_type: AgentConfigTargetType::ProjectContext,
            format: AgentConfigFormat::Markdown,
            description: "Codex/shared project instructions in AGENTS.md",
            path_kind: PathKind::Project("AGENTS.md"),
        },
        TargetSpec {
            id: "claude_global",
            agent_id: "claude_code",
            target_type: AgentConfigTargetType::NativeConfig,
            format: AgentConfigFormat::Json,
            description: "Claude Code global settings.json",
            path_kind: PathKind::Home(&[".claude", "settings.json"]),
        },
        TargetSpec {
            id: "claude_legacy_global",
            agent_id: "claude_code",
            target_type: AgentConfigTargetType::NativeConfig,
            format: AgentConfigFormat::Json,
            description: "Claude legacy global config",
            path_kind: PathKind::Home(&[".claude.json"]),
        },
        TargetSpec {
            id: "claude_project",
            agent_id: "claude_code",
            target_type: AgentConfigTargetType::ProjectContext,
            format: AgentConfigFormat::Markdown,
            description: "Claude Code project instructions in CLAUDE.md",
            path_kind: PathKind::Project("CLAUDE.md"),
        },
        TargetSpec {
            id: "gemini_global",
            agent_id: "gemini",
            target_type: AgentConfigTargetType::NativeConfig,
            format: AgentConfigFormat::Json,
            description: "Gemini CLI global settings.json",
            path_kind: PathKind::Home(&[".gemini", "settings.json"]),
        },
        TargetSpec {
            id: "gemini_project",
            agent_id: "gemini",
            target_type: AgentConfigTargetType::ProjectContext,
            format: AgentConfigFormat::Markdown,
            description: "Gemini CLI project instructions in GEMINI.md",
            path_kind: PathKind::Project("GEMINI.md"),
        },
        TargetSpec {
            id: "opencode_global",
            agent_id: "opencode",
            target_type: AgentConfigTargetType::NativeConfig,
            format: AgentConfigFormat::Json,
            description: "OpenCode global config.json",
            path_kind: PathKind::AppDataOrHome(
                &["opencode", "config.json"],
                &[".config", "opencode", "config.json"],
            ),
        },
        TargetSpec {
            id: "opencode_project",
            agent_id: "opencode",
            target_type: AgentConfigTargetType::ProjectContext,
            format: AgentConfigFormat::Markdown,
            description: "OpenCode/shared project instructions in AGENTS.md",
            path_kind: PathKind::Project("AGENTS.md"),
        },
    ]
}

fn home_dir(home_override: Option<&Path>) -> AelResult<PathBuf> {
    if let Some(path) = home_override {
        return Ok(path.to_path_buf());
    }
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| {
            AelError::io_error("cannot locate user home directory; HOME/USERPROFILE are unset")
        })
}

fn project_cwd(cwd: Option<&str>) -> AelResult<PathBuf> {
    let raw = cwd.map(PathBuf::from).unwrap_or(std::env::current_dir()?);
    if !raw.exists() {
        return Err(AelError::not_found(format!(
            "project cwd does not exist: {}",
            raw.to_string_lossy()
        )));
    }
    fs::canonicalize(raw).map_err(AelError::from)
}

fn join(root: PathBuf, parts: &[&str]) -> PathBuf {
    parts.iter().fold(root, |path, part| path.join(part))
}

fn safe_segment(input: &str) -> String {
    input
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}
