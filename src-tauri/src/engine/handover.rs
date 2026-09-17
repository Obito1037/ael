//! generate_handover_prompt:把任务 + 证据链 + 相关 Skill/Failure + 未决问题
//! 组织成一段「接手 Agent 读完即可上手」的 Prompt。
//! 也被 Codex 的 handover/pack 复用,写进 manifest.json 的 handover_prompt。

use super::search;
use crate::db::Db;
use crate::error::AelResult;
use crate::models::{EventKind, Settings, TaskEvent};
use std::fmt::Write as _;

const RELATED_LIMIT: i64 = 8;

pub fn generate_handover_prompt(db: &Db, task_id: &str, settings: &Settings) -> AelResult<String> {
    let task = db.get_task(task_id)?;
    let events = db.list_events(task_id)?;
    let skills = search::suggested_skills(
        db,
        &task.goal,
        &task.tags,
        RELATED_LIMIT,
        settings.guard_min_score,
    )?;
    let failures = search::matched_failures(
        db,
        &task.goal,
        &task.tags,
        RELATED_LIMIT,
        settings.guard_min_score,
    )?;
    let open_questions = collect_open_questions(&events);

    let mut p = String::new();
    let _ = writeln!(p, "# 任务接手 Prompt");
    let _ = writeln!(p);
    let _ = writeln!(
        p,
        "你将接手一个进行中的任务。读完本文即可继续,无需向人重新确认上下文。"
    );
    let _ = writeln!(p);

    let _ = writeln!(p, "## 任务");
    let _ = writeln!(p, "- 标题:{}", task.title);
    let _ = writeln!(p, "- 目标:{}", task.goal);
    let _ = writeln!(p, "- 状态:{}", task.status.as_str());
    if !task.tags.is_empty() {
        let _ = writeln!(p, "- 标签:{}", task.tags.join(", "));
    }
    if let Some(path) = &task.repo_path {
        let branch = task.repo_branch.as_deref().unwrap_or("-");
        let commit = task.repo_commit.as_deref().unwrap_or("-");
        let _ = writeln!(p, "- 仓库:{path}(branch {branch} @ {commit})");
        let _ = writeln!(p, "  接手前请把工作树对齐到该 commit/branch。");
    }
    let _ = writeln!(p);

    let _ = writeln!(p, "## 已经做了什么(证据链,按时序)");
    if events.is_empty() {
        let _ = writeln!(p, "(暂无记录)");
    } else {
        for e in &events {
            let tag = kind_label(e.kind);
            let _ = writeln!(p, "{:>3}. [{}] {}", e.seq, tag, e.summary.trim());
            if let Some(d) = &e.detail {
                if !d.trim().is_empty() {
                    let _ = writeln!(p, "      ↳ {}", d.trim());
                }
            }
        }
    }
    let _ = writeln!(p);

    // 本任务内已踩的坑(error→fix)与已做的决策 —— 让接手者不必重读全时间线即可掌握。
    let in_task_pitfalls = collect_in_task_pitfalls(&events);
    let in_task_decisions = collect_in_task_decisions(&events);
    if !in_task_pitfalls.is_empty() || !in_task_decisions.is_empty() {
        let _ = writeln!(p, "## 此前的坑与决策(本任务,接手必读)");
        for (problem, fix) in &in_task_pitfalls {
            match fix {
                Some(f) => {
                    let _ = writeln!(p, "- 坑:{}  →  已处理:{}", problem.trim(), f.trim());
                }
                None => {
                    let _ = writeln!(p, "- 坑(尚未解决):{}", problem.trim());
                }
            }
        }
        for (decision, reason) in &in_task_decisions {
            match reason {
                Some(r) => {
                    let _ = writeln!(p, "- 决策:{}(理由:{})", decision.trim(), r.trim());
                }
                None => {
                    let _ = writeln!(p, "- 决策:{}", decision.trim());
                }
            }
        }
        let _ = writeln!(p);
    }

    if !failures.is_empty() {
        let _ = writeln!(p, "## 必须规避的坑(历史失败)");
        for f in &failures {
            let _ = writeln!(
                p,
                "- {} → 约束:{}",
                f.description.trim(),
                f.guard_rule.trim()
            );
        }
        let _ = writeln!(p);
    }

    if !skills.is_empty() {
        let _ = writeln!(p, "## 可复用的经验(Skill)");
        for s in &skills {
            let _ = writeln!(p, "- {}:{}", s.name.trim(), s.trigger.trim());
        }
        let _ = writeln!(p);
    }

    if !open_questions.is_empty() {
        let _ = writeln!(p, "## 未决问题(需要你判断或推进)");
        for q in &open_questions {
            let _ = writeln!(p, "- {}", q);
        }
        let _ = writeln!(p);
    }

    let _ = writeln!(p, "## 你的下一步");
    let _ = writeln!(p, "先对齐上面的约束与未决问题,再继续推进目标。每做一步,把过程作为新事件追加到本任务的证据链,便于下一次交接。");

    Ok(p)
}

fn kind_label(kind: EventKind) -> &'static str {
    match kind {
        EventKind::Step => "步骤",
        EventKind::Error => "错误",
        EventKind::Fix => "修复",
        EventKind::Verification => "验证",
        EventKind::Decision => "决策",
        EventKind::Note => "备注",
    }
}

/// 本任务内的坑:每个 error 事件 + 其后第一条 fix(若有)。返回 (问题, 已处理?)。
fn collect_in_task_pitfalls(events: &[TaskEvent]) -> Vec<(String, Option<String>)> {
    let mut out = Vec::new();
    let mut fix_used = vec![false; events.len()];
    for (i, ev) in events.iter().enumerate() {
        if ev.kind != EventKind::Error {
            continue;
        }
        let fix = events
            .iter()
            .enumerate()
            .skip(i + 1)
            .find(|(j, e)| e.kind == EventKind::Fix && !fix_used[*j]);
        let fix_text = fix.map(|(j, f)| {
            fix_used[j] = true;
            f.summary.clone()
        });
        out.push((ev.summary.clone(), fix_text));
    }
    out
}

/// 本任务内的决策:decision 事件 + detail 作为理由。
fn collect_in_task_decisions(events: &[TaskEvent]) -> Vec<(String, Option<String>)> {
    events
        .iter()
        .filter(|e| e.kind == EventKind::Decision)
        .map(|e| {
            let reason = e
                .detail
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            (e.summary.clone(), reason)
        })
        .collect()
}

/// 未决问题:decision/note 事件里带「?」或「未决/待定/TODO」标记的条目。
fn collect_open_questions(events: &[TaskEvent]) -> Vec<String> {
    let markers = ["?", "?", "未决", "待定", "todo", "TODO"];
    events
        .iter()
        .filter(|e| matches!(e.kind, EventKind::Decision | EventKind::Note))
        .filter_map(|e| {
            let text = e.detail.as_deref().unwrap_or(&e.summary);
            let hit = markers
                .iter()
                .any(|m| text.contains(m) || e.summary.contains(m));
            hit.then(|| e.summary.trim().to_string())
        })
        .collect()
}
