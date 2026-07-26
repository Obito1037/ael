//! finalize_task:扫描证据链(task_events)→ 产出待人工确认的 draft Skill/Failure。
//! 规则见 contracts/DECISIONS.md 决策 3。所有草案 status='draft'。

use super::normalize;
use crate::db::Db;
use crate::error::AelResult;
use crate::models::{
    EventKind, Failure, FinalizeResult, NewFailure, NewSkill, Skill, SkillStatus, Task, TaskEvent,
    TaskStatus,
};

pub fn finalize_task(db: &Db, task_id: &str) -> AelResult<FinalizeResult> {
    let task = db.get_task(task_id)?;
    let events = db.list_events(task_id)?;

    let draft_failures = extract_failures(db, &task, &events)?;
    let draft_skills = extract_skill(db, &task, &events)?;

    Ok(FinalizeResult {
        task,
        draft_skills,
        draft_failures,
    })
}

/// 从 error→fix 配对提炼 Failure。已存在同 signature 则 occurrences+1(不新建)。
fn extract_failures(db: &Db, task: &Task, events: &[TaskEvent]) -> AelResult<Vec<Failure>> {
    let mut out = Vec::new();
    let mut fix_used = vec![false; events.len()];

    for (i, ev) in events.iter().enumerate() {
        if ev.kind != EventKind::Error {
            continue;
        }
        // 向后找第一条尚未认领、解决本错误的 fix。
        let fix = events
            .iter()
            .enumerate()
            .skip(i + 1)
            .find(|(j, e)| e.kind == EventKind::Fix && !fix_used[*j]);

        let error_text = combine(&ev.summary, ev.detail.as_deref());
        let (normalized_text, signature) = normalize::normalize_and_sign(&error_text);

        // 去重:同签名只 bump。
        if let Some(existing) = db.find_failure_by_signature(&signature)? {
            let bumped = db.bump_failure(&existing.id)?;
            out.push(bumped);
            if let Some((j, _)) = fix {
                fix_used[j] = true;
            }
            continue;
        }

        let (fix_text, guard_rule) = match fix {
            Some((j, fx)) => {
                fix_used[j] = true;
                let fix_text = combine(&fx.summary, fx.detail.as_deref());
                (Some(fix_text), derive_guard_rule(&ev.summary, &fx.summary))
            }
            None => (
                None,
                format!("遇到「{}」类问题时,先复现并定位根因再动手。", ev.summary),
            ),
        };

        let new = NewFailure {
            task_id: Some(task.id.clone()),
            source_event_id: Some(ev.id.clone()),
            signature,
            normalized_text,
            description: ev.summary.clone(),
            root_cause: ev.detail.clone(),
            fix: fix_text,
            guard_rule,
            tags: task.tags.clone(),
        };
        out.push(db.insert_failure(new)?);
    }
    Ok(out)
}

/// 仅 verified 任务产 Skill;按 source_task_id 去重(避免重复 finalize 刷草案)。
fn extract_skill(db: &Db, task: &Task, events: &[TaskEvent]) -> AelResult<Vec<Skill>> {
    if task.status != TaskStatus::Verified {
        return Ok(Vec::new());
    }
    // 该任务已沉淀过 Skill?跳过新建,返回既有的。
    let existing: Vec<Skill> = db
        .list_skills(None, 1000, 0)?
        .into_iter()
        .filter(|s| s.source_task_id.as_deref() == Some(task.id.as_str()))
        .collect();
    if !existing.is_empty() {
        return Ok(existing);
    }

    let trigger = derive_trigger(&task.goal, &task.tags);
    let body = build_skill_body(events);
    let new = NewSkill {
        name: task.title.clone(),
        trigger,
        body,
        tags: task.tags.clone(),
        source_task_id: Some(task.id.clone()),
        status: SkillStatus::Draft,
    };
    Ok(vec![db.create_skill(new)?])
}

// ── 文本生成 ──────────────────────────────────────────────────

fn combine(summary: &str, detail: Option<&str>) -> String {
    match detail {
        Some(d) if !d.trim().is_empty() => format!("{summary}\n{d}"),
        _ => summary.to_string(),
    }
}

/// 由 fix 反写成一句祈使约束。
fn derive_guard_rule(error_summary: &str, fix_summary: &str) -> String {
    format!("遇到「{}」时:{}", error_summary.trim(), fix_summary.trim())
}

/// trigger = goal + tags 概括的「相似任务特征」,不照抄流水账。
fn derive_trigger(goal: &str, tags: &[String]) -> String {
    if tags.is_empty() {
        format!("与目标「{}」相似的任务", goal.trim())
    } else {
        format!(
            "涉及 [{}],且与「{}」相似的任务",
            tags.join(", "),
            goal.trim()
        )
    }
}

/// body = 步骤(step)+ 关键决策(decision)+ 如何验证(verification)。
fn build_skill_body(events: &[TaskEvent]) -> String {
    let mut body = String::new();

    let steps: Vec<&TaskEvent> = events
        .iter()
        .filter(|e| e.kind == EventKind::Step)
        .collect();
    let decisions: Vec<&TaskEvent> = events
        .iter()
        .filter(|e| e.kind == EventKind::Decision)
        .collect();
    let verifications: Vec<&TaskEvent> = events
        .iter()
        .filter(|e| e.kind == EventKind::Verification)
        .collect();

    body.push_str("## 步骤\n");
    if steps.is_empty() {
        body.push_str("(本任务未记录显式步骤)\n");
    } else {
        for (i, s) in steps.iter().enumerate() {
            body.push_str(&format!("{}. {}\n", i + 1, s.summary.trim()));
            if let Some(d) = &s.detail {
                if !d.trim().is_empty() {
                    body.push_str(&format!("   - {}\n", d.trim()));
                }
            }
        }
    }

    if !decisions.is_empty() {
        body.push_str("\n## 关键决策\n");
        for d in &decisions {
            let reason = d.detail.as_deref().unwrap_or("").trim();
            if reason.is_empty() {
                body.push_str(&format!("- {}\n", d.summary.trim()));
            } else {
                body.push_str(&format!("- {}:{}\n", d.summary.trim(), reason));
            }
        }
    }

    body.push_str("\n## 如何验证\n");
    if verifications.is_empty() {
        body.push_str("(未记录验证步骤,补充后再转 active)\n");
    } else {
        for v in &verifications {
            body.push_str(&format!("- {}\n", v.summary.trim()));
        }
    }

    body
}
