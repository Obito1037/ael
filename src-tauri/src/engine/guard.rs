//! Failure Guard(check_failure_guard)。
//! 新任务开始时用 goal + tags 命中历史失败 + 相关 Skill,产出可直接注入 Agent 的上下文。

use super::search;
use crate::db::Db;
use crate::error::AelResult;
use crate::models::{GuardResult, Settings};

const MATCH_LIMIT: i64 = 10;

pub fn check_failure_guard(
    db: &Db,
    goal: &str,
    tags: &[String],
    settings: &Settings,
) -> AelResult<GuardResult> {
    let min = settings.guard_min_score;
    let matched_failures = search::matched_failures(db, goal, tags, MATCH_LIMIT, min)?;
    let suggested_skills = search::suggested_skills(db, goal, tags, MATCH_LIMIT, min)?;

    // 约束 = 命中失败的 guard_rule(去重、保序)。
    let mut seen = std::collections::HashSet::new();
    let constraints: Vec<String> = matched_failures
        .iter()
        .map(|f| f.guard_rule.trim().to_string())
        .filter(|r| !r.is_empty() && seen.insert(r.clone()))
        .collect();

    let handover_prompt = render_prompt(goal, &matched_failures, &suggested_skills, &constraints);

    Ok(GuardResult {
        matched_failures,
        suggested_skills,
        constraints,
        handover_prompt,
    })
}

fn render_prompt(
    goal: &str,
    failures: &[crate::models::Failure],
    skills: &[crate::models::Skill],
    constraints: &[String],
) -> String {
    if failures.is_empty() && skills.is_empty() {
        return String::new();
    }
    let mut out = String::new();
    out.push_str("【开始前的经验提醒】\n");
    out.push_str(&format!("当前任务目标:{goal}\n"));

    if !constraints.is_empty() {
        out.push_str("\n必须遵守的约束(来自历史失败):\n");
        for (i, c) in constraints.iter().enumerate() {
            out.push_str(&format!("{}. {}\n", i + 1, c));
        }
    }

    if !failures.is_empty() {
        out.push_str("\n这些坑以前踩过,务必规避:\n");
        for f in failures {
            let cause = f.root_cause.as_deref().unwrap_or("(根因未记录)");
            out.push_str(&format!(
                "- {}(出现 {} 次)· 根因:{}\n",
                f.description, f.occurrences, cause
            ));
        }
    }

    if !skills.is_empty() {
        out.push_str("\n可复用的既有经验(Skill):\n");
        for s in skills {
            out.push_str(&format!("- {}:{}\n", s.name, s.trigger));
        }
    }

    out.push_str("\n以上为自动注入的相关经验,已过相关度阈值。请在动手前对照执行。");
    out
}
