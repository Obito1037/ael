//! Backend-owned startup context for launching CLI agents.
//!
//! This is the implemented counterpart of the starter-kit
//! `build_launch_context` draft. The UI can preview the returned `prompt` and
//! pass it into `start_agent_session.initialPrompt`.

use crate::db::Db;
use crate::engine::{guard, handover};
use crate::error::AelResult;
use crate::models::{Failure, Settings, Skill, Task, TaskEvent};
use serde::Serialize;

const DEFAULT_EVENT_LIMIT: usize = 12;
const DEFAULT_SKILL_LIMIT: usize = 5;
const HANDOVER_EXCERPT_CHARS: usize = 4_000;
const COMPACT_HANDOVER_CHARS: usize = 1_200;

#[derive(Debug, Clone, Default)]
pub struct BuildAgentStartupContextOptions {
    pub agent_kind: Option<String>,
    pub profile_id: Option<String>,
    pub manual_note: Option<String>,
    pub event_limit: Option<usize>,
    pub skill_limit: Option<usize>,
    pub include_guard: Option<bool>,
    pub include_skills: Option<bool>,
    pub include_handover: Option<bool>,
    pub token_budget: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStartupContextPart {
    pub key: String,
    pub title: String,
    pub included: bool,
    pub tokens_est: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStartupContext {
    pub task: Task,
    pub agent_kind: Option<String>,
    pub profile_id: Option<String>,
    pub recent_events: Vec<TaskEvent>,
    pub matched_failures: Vec<Failure>,
    pub suggested_skills: Vec<Skill>,
    pub constraints: Vec<String>,
    pub handover_excerpt: Option<String>,
    pub manual_note: Option<String>,
    pub tokens_est: u64,
    pub parts: Vec<AgentStartupContextPart>,
    pub prompt: String,
}

pub fn build_agent_startup_context(
    db: &Db,
    task_id: &str,
    options: BuildAgentStartupContextOptions,
    settings: &Settings,
) -> AelResult<AgentStartupContext> {
    let task = db.get_task(task_id)?;
    let all_events = db.list_events(task_id)?;
    let recent_events = take_last(
        all_events.clone(),
        options.event_limit.unwrap_or(DEFAULT_EVENT_LIMIT),
    );

    let include_guard = options.include_guard.unwrap_or(true);
    let include_skills = options.include_skills.unwrap_or(true);
    let include_handover = options.include_handover.unwrap_or(true);

    let guard_result = if include_guard || include_skills {
        Some(guard::check_failure_guard(
            db, &task.goal, &task.tags, settings,
        )?)
    } else {
        None
    };

    let matched_failures = if include_guard {
        guard_result
            .as_ref()
            .map(|result| result.matched_failures.clone())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let constraints = if include_guard {
        guard_result
            .as_ref()
            .map(|result| result.constraints.clone())
            .unwrap_or_default()
    } else {
        Vec::new()
    };
    let suggested_skills = if include_skills {
        guard_result
            .as_ref()
            .map(|result| {
                result
                    .suggested_skills
                    .iter()
                    .take(options.skill_limit.unwrap_or(DEFAULT_SKILL_LIMIT))
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    } else {
        Vec::new()
    };

    let handover_excerpt = if include_handover {
        Some(excerpt(
            &handover::generate_handover_prompt(db, task_id, settings)?,
            HANDOVER_EXCERPT_CHARS,
        ))
    } else {
        None
    };

    let manual_note = options.manual_note.as_deref().and_then(non_empty);

    let mut render = render_prompt(RenderInput {
        task: &task,
        agent_kind: options.agent_kind.as_deref(),
        profile_id: options.profile_id.as_deref(),
        events: &recent_events,
        failures: &matched_failures,
        skills: &suggested_skills,
        constraints: &constraints,
        handover_excerpt: handover_excerpt.as_deref(),
        manual_note: manual_note.as_deref(),
        compact: false,
    });

    if let Some(budget) = options.token_budget {
        if render.tokens_est > budget {
            render = render_prompt(RenderInput {
                task: &task,
                agent_kind: options.agent_kind.as_deref(),
                profile_id: options.profile_id.as_deref(),
                events: &take_last(recent_events.clone(), recent_events.len().min(5)),
                failures: &matched_failures.iter().take(5).cloned().collect::<Vec<_>>(),
                skills: &suggested_skills,
                constraints: &constraints,
                handover_excerpt: handover_excerpt
                    .as_ref()
                    .map(|text| excerpt(text, COMPACT_HANDOVER_CHARS))
                    .as_deref(),
                manual_note: manual_note.as_deref(),
                compact: true,
            });
        }
    }

    Ok(AgentStartupContext {
        task,
        agent_kind: options.agent_kind,
        profile_id: options.profile_id,
        recent_events,
        matched_failures,
        suggested_skills,
        constraints,
        handover_excerpt,
        manual_note,
        tokens_est: render.tokens_est,
        parts: render.parts,
        prompt: render.prompt,
    })
}

struct RenderInput<'a> {
    task: &'a Task,
    agent_kind: Option<&'a str>,
    profile_id: Option<&'a str>,
    events: &'a [TaskEvent],
    failures: &'a [Failure],
    skills: &'a [Skill],
    constraints: &'a [String],
    handover_excerpt: Option<&'a str>,
    manual_note: Option<&'a str>,
    compact: bool,
}

struct RenderedPrompt {
    prompt: String,
    parts: Vec<AgentStartupContextPart>,
    tokens_est: u64,
}

fn render_prompt(input: RenderInput<'_>) -> RenderedPrompt {
    let mut parts = Vec::new();
    let mut out = String::new();

    push_section(
        &mut out,
        &mut parts,
        "task",
        format!(
            "# Launch Context - {}\n\n{}",
            input.task.title,
            task_section(&input)
        ),
        true,
    );
    push_section(
        &mut out,
        &mut parts,
        "constraints",
        constraints_section(input.constraints),
        true,
    );
    push_section(
        &mut out,
        &mut parts,
        "failures",
        failures_section(input.failures),
        !input.failures.is_empty(),
    );
    push_section(
        &mut out,
        &mut parts,
        "skills",
        skills_section(input.skills, input.compact),
        !input.skills.is_empty(),
    );
    push_section(&mut out, &mut parts, "repo", repo_section(input.task), true);
    push_section(
        &mut out,
        &mut parts,
        "handover",
        handover_section(input.events, input.handover_excerpt),
        input.handover_excerpt.is_some() || !input.events.is_empty(),
    );
    if let Some(note) = input.manual_note {
        push_section(
            &mut out,
            &mut parts,
            "manual_note",
            format!("## User Launch Note\n{note}\n"),
            true,
        );
    }
    push_section(
        &mut out,
        &mut parts,
        "discipline",
        discipline_section(),
        true,
    );

    let tokens_est = estimate_tokens(&out);
    RenderedPrompt {
        prompt: out,
        parts,
        tokens_est,
    }
}

fn task_section(input: &RenderInput<'_>) -> String {
    let mut out = String::new();
    out.push_str("## 0. Task\n");
    push_kv(&mut out, "Goal", &input.task.goal);
    push_kv(&mut out, "Tags", &or_none(input.task.tags.join(", ")));
    push_kv(&mut out, "Status", input.task.status.as_str());
    if let Some(agent_kind) = input.agent_kind {
        push_kv(&mut out, "Launch agent", agent_kind);
    }
    if let Some(profile_id) = input.profile_id {
        push_kv(&mut out, "Profile", profile_id);
    }
    if let Some(agent_id) = &input.task.agent_id {
        push_kv(&mut out, "Recorded source", agent_id);
    }
    out
}

fn constraints_section(constraints: &[String]) -> String {
    let mut out = String::new();
    out.push_str("## 1. Mandatory Constraints From Failure Guard\n");
    out.push_str(
        "Treat this section as hard constraints. Violating it means repeating a known mistake.\n",
    );
    if constraints.is_empty() {
        out.push_str("- No matching historical constraints were found.\n");
    } else {
        for constraint in constraints {
            out.push_str(&format!("- {}\n", constraint.trim()));
        }
    }
    out
}

fn failures_section(failures: &[Failure]) -> String {
    let mut out = String::new();
    out.push_str("## 2. Pitfalls To Avoid\n");
    if failures.is_empty() {
        out.push_str("- None above the relevance threshold.\n");
    } else {
        for failure in failures {
            out.push_str(&format!(
                "- {} (occurrences: {}; avoid by: {})\n",
                failure.description.trim(),
                failure.occurrences,
                failure.guard_rule.trim()
            ));
            if let Some(root_cause) = &failure.root_cause {
                out.push_str(&format!("  Root cause: {}\n", root_cause.trim()));
            }
            if let Some(fix) = &failure.fix {
                out.push_str(&format!("  Known fix: {}\n", fix.trim()));
            }
        }
    }
    out
}

fn skills_section(skills: &[Skill], compact: bool) -> String {
    let mut out = String::new();
    out.push_str("## 3. Reusable Skills\n");
    if skills.is_empty() {
        out.push_str("- None above the relevance threshold.\n");
    } else {
        for skill in skills {
            out.push_str(&format!(
                "- {}: {}\n",
                skill.name.trim(),
                skill.trigger.trim()
            ));
            if !compact {
                let body = first_section(&skill.body);
                if !body.is_empty() {
                    out.push_str(&format!("  {}\n", indent_inline(&excerpt(&body, 900))));
                }
            }
        }
    }
    out
}

fn repo_section(task: &Task) -> String {
    let mut out = String::new();
    out.push_str("## 4. Repository And Worktree Alignment\n");
    push_kv(
        &mut out,
        "Path",
        task.repo_path.as_deref().unwrap_or("(path not recorded)"),
    );
    push_kv(
        &mut out,
        "Branch",
        task.repo_branch
            .as_deref()
            .unwrap_or("(branch not recorded)"),
    );
    push_kv(
        &mut out,
        "Commit",
        task.repo_commit
            .as_deref()
            .unwrap_or("(commit not recorded)"),
    );
    out.push_str("- Align the worktree to the recorded branch/commit before editing when those values are present.\n");
    out
}

fn handover_section(events: &[TaskEvent], handover_excerpt: Option<&str>) -> String {
    let mut out = String::new();
    out.push_str("## 5. Current Progress And Handover Notes\n");
    if events.is_empty() {
        out.push_str("- No prior task events.\n");
    } else {
        out.push_str("Recent evidence:\n");
        for event in events {
            out.push_str(&format!(
                "{}. [{}] {}\n",
                event.seq,
                event.kind.as_str(),
                event.summary.trim()
            ));
            if let Some(detail) = &event.detail {
                if !detail.trim().is_empty() {
                    out.push_str(&format!("   Detail: {}\n", detail.trim()));
                }
            }
        }
    }
    if let Some(handover) = handover_excerpt {
        out.push_str("\nHandover excerpt:\n");
        out.push_str(handover.trim());
        out.push('\n');
    }
    out
}

fn discipline_section() -> String {
    [
        "## 6. Working Discipline",
        "- Record each meaningful step, error, fix, decision, and verification in terminal output so AEL can ingest it into the evidence chain.",
        "- When a mandatory constraint applies, state explicitly how you followed it.",
        "- Verify before declaring completion and report the exact command or artifact used.",
        "- If blocked, state the blocker and the next required input clearly.",
        "- When you commit, append the provenance trailer so any line stays traceable to this task:",
        "  git commit -m \"<subject>\" -m \"AEL-Task: <task-id>\"",
        "- A runtime policy gate sits between you and the shell: destructive commands (rm -rf, secret egress, DROP TABLE, force-push to main) will be held for human approval. Prefer safe, reversible steps.",
        "",
    ]
    .join("\n")
}

fn push_section(
    out: &mut String,
    parts: &mut Vec<AgentStartupContextPart>,
    key: &str,
    content: String,
    included: bool,
) {
    if included {
        out.push_str(&content);
        if !content.ends_with("\n\n") {
            out.push('\n');
        }
    }
    parts.push(AgentStartupContextPart {
        key: key.to_string(),
        title: key.replace('_', " "),
        included,
        tokens_est: if included {
            estimate_tokens(&content)
        } else {
            0
        },
    });
}

fn take_last<T: Clone>(items: Vec<T>, limit: usize) -> Vec<T> {
    if limit == 0 || items.is_empty() {
        return Vec::new();
    }
    let start = items.len().saturating_sub(limit);
    items[start..].to_vec()
}

fn push_kv(out: &mut String, key: &str, value: &str) {
    out.push_str(&format!("- {key}: {value}\n"));
}

fn or_none(value: String) -> String {
    if value.trim().is_empty() {
        "none".to_string()
    } else {
        value
    }
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn excerpt(value: &str, max_chars: usize) -> String {
    let mut out = String::new();
    for ch in value.chars().take(max_chars) {
        out.push(ch);
    }
    if value.chars().count() > max_chars {
        out.push_str("\n[truncated]");
    }
    out
}

fn first_section(markdown: &str) -> String {
    let mut out = Vec::new();
    let mut seen_content = false;
    for line in markdown.lines() {
        if seen_content && line.starts_with("## ") {
            break;
        }
        if !line.trim().is_empty() {
            seen_content = true;
        }
        out.push(line);
    }
    out.join("\n").trim().to_string()
}

fn indent_inline(text: &str) -> String {
    text.lines().collect::<Vec<_>>().join("\n  ")
}

fn estimate_tokens(text: &str) -> u64 {
    ((text.chars().count() as f64) / 4.0).ceil() as u64
}
