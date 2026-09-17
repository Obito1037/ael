//! Skill 生命周期命令。create 默认 draft;计数由 DB 触发器维护。

use crate::error::{AelError, AelResult};
use crate::models::{NewSkill, Outcome, Skill, SkillExportResult, SkillPatch, SkillStatus};
use crate::state::AppState;
use std::path::PathBuf;
use std::process::Command;
use tauri::State;

#[tauri::command]
pub fn list_skills(
    state: State<AppState>,
    status: Option<SkillStatus>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AelResult<Vec<Skill>> {
    state
        .db
        .list_skills(status, limit.unwrap_or(50), offset.unwrap_or(0))
}

#[tauri::command]
pub fn get_skill(state: State<AppState>, id: String) -> AelResult<Skill> {
    state.db.get_skill(&id)
}

#[tauri::command]
pub fn create_skill(
    state: State<AppState>,
    name: String,
    trigger: String,
    body: String,
    tags: Option<Vec<String>>,
    source_task_id: Option<String>,
) -> AelResult<Skill> {
    state.db.create_skill(NewSkill {
        name,
        trigger,
        body,
        tags: tags.unwrap_or_default(),
        source_task_id,
        status: SkillStatus::Draft,
        origin_agent: None,
        origin_model: None,
    })
}

#[tauri::command]
pub fn update_skill(
    state: State<AppState>,
    id: String,
    name: Option<String>,
    trigger: Option<String>,
    body: Option<String>,
    tags: Option<Vec<String>>,
) -> AelResult<Skill> {
    state.db.update_skill(
        &id,
        SkillPatch {
            name,
            trigger,
            body,
            tags,
        },
    )
}

#[tauri::command]
pub fn update_skill_status(
    state: State<AppState>,
    id: String,
    status: SkillStatus,
) -> AelResult<Skill> {
    state.db.update_skill_status(&id, status)
}

#[tauri::command]
pub fn record_skill_usage(
    state: State<AppState>,
    skill_id: String,
    task_id: String,
    outcome: Outcome,
) -> AelResult<()> {
    state.db.record_skill_usage(&skill_id, &task_id, outcome)
}

/// 将已确认的 Skill 写成标准 SKILL.md；如果用户指定了目标 Agent 且本机
/// 存在 skills CLI，再调用它完成分发。CLI 不可用时保留可移植文件并返回路径。
#[tauri::command]
pub fn export_skill(
    state: State<AppState>,
    id: String,
    agents: Option<Vec<String>>,
) -> AelResult<SkillExportResult> {
    let skill = state.db.get_skill(&id)?;
    if skill.status != SkillStatus::Active {
        return Err(AelError::conflict("只有已确认并启用的 Skill 才能导出"));
    }

    let folder = safe_slug(&skill.id);
    let root = state.db.paths.skills.join(&folder);
    std::fs::create_dir_all(&root)?;
    let target = root.join("SKILL.md");
    crate::db::init::atomic_write(&target, skill_markdown(&skill).as_bytes())?;

    let requested = agents.unwrap_or_default();
    if requested.is_empty() {
        return Ok(SkillExportResult {
            path: target.to_string_lossy().to_string(),
            published_by_cli: false,
            message: "已导出标准 SKILL.md；未指定 Agent，因此未执行外部分发。".into(),
        });
    }
    let normalized_agents = requested
        .iter()
        .map(|agent| normalize_agent(agent))
        .collect::<Option<Vec<_>>>()
        .ok_or_else(|| AelError::invalid_input("不支持的 Skill 目标 Agent"))?;

    let Some((cli, cli_prefix)) = locate_skills_cli() else {
        return Ok(SkillExportResult {
            path: target.to_string_lossy().to_string(),
            published_by_cli: false,
            message: "本机未发现 skills CLI 或 npx，已保留标准 SKILL.md，可手动交给目标 Agent。"
                .into(),
        });
    };

    let mut command = Command::new(&cli);
    command.args(cli_prefix);
    command
        .arg("add")
        .arg(&state.db.paths.skills)
        .arg("--skill")
        .arg(&folder)
        .arg("--copy")
        .arg("-g")
        .arg("-y");
    for agent in &normalized_agents {
        command.arg("--agent").arg(agent);
    }
    let output = command.output()?;
    if output.status.success() {
        Ok(SkillExportResult {
            path: target.to_string_lossy().to_string(),
            published_by_cli: true,
            message: format!("已由 skills CLI 分发到：{}。", normalized_agents.join(", ")),
        })
    } else {
        let detail = String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(300)
            .collect::<String>();
        Ok(SkillExportResult {
            path: target.to_string_lossy().to_string(),
            published_by_cli: false,
            message: if detail.is_empty() {
                "skills CLI 分发失败，已保留标准 SKILL.md。".into()
            } else {
                format!("skills CLI 分发失败，已保留标准 SKILL.md：{detail}")
            },
        })
    }
}

fn normalize_agent(agent: &str) -> Option<String> {
    match agent.trim() {
        "codex" => Some("codex".into()),
        "claude_code" | "claude-code" => Some("claude-code".into()),
        "gemini" | "gemini-cli" => Some("gemini-cli".into()),
        "opencode" | "open-code" => Some("opencode".into()),
        _ => None,
    }
}

fn locate_skills_cli() -> Option<(PathBuf, Vec<String>)> {
    let locator = if cfg!(windows) { "where.exe" } else { "which" };
    let direct_name = if cfg!(windows) {
        "skills.cmd"
    } else {
        "skills"
    };
    if let Ok(output) = Command::new(locator).arg(direct_name).output() {
        if output.status.success() {
            if let Some(path) = String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(str::trim)
                .find(|line| !line.is_empty())
                .map(PathBuf::from)
            {
                return Some((path, Vec::new()));
            }
        }
    }

    // 官方 CLI 也支持 npx skills ...；Windows 上通常只有 npx.cmd，
    // 因此在没有全局 skills.cmd 时按需调用 npx，不在启动时联网或安装。
    let npx_name = if cfg!(windows) { "npx.cmd" } else { "npx" };
    let output = Command::new(locator).arg(npx_name).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|path| {
            (
                PathBuf::from(path),
                vec!["-y".to_string(), "skills".to_string()],
            )
        })
}

fn safe_slug(value: &str) -> String {
    let mut value = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    while value.contains("--") {
        value = value.replace("--", "-");
    }
    let value = value.trim_matches('-').to_string();
    if value.is_empty() {
        "skill".into()
    } else {
        value
    }
}

fn skill_markdown(skill: &Skill) -> String {
    let description = skill.trigger.replace(['\n', '\r'], " ");
    let tags = if skill.tags.is_empty() {
        "（无）".into()
    } else {
        skill.tags.join(", ")
    };
    format!("---\nname: {}\ndescription: {}\n---\n\n# {}\n\n{}\n\n## Tags\n{}\n\n## Provenance\n- skill_id: {}\n- source_task_id: {}\n- status: {:?}\n", safe_slug(&skill.id), description, skill.name, skill.body, tags, skill.id, skill.source_task_id.as_deref().unwrap_or("未记录"), skill.status)
}
