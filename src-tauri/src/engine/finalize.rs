//! finalize = 编译器(升级自 1.0):同一条证据链编译出
//!   ① draft Failure(error→fix 配对、签名去重 bump)
//!   ② draft Skill(仅 verified 任务)
//!   ③ Review Brief(出口①)
//!   ④ ADR(出口④,decision 事件)
//! 草案 status='draft',经人工确认后转 active。

use super::{adr, brief, normalize};
use crate::db::Db;
use crate::error::AelResult;
use crate::models::{
    EventKind, Failure, FinalizeResult, NewFailure, NewSkill, Skill, SkillStatus, Task, TaskEvent,
    TaskStatus,
};

pub fn finalize_task(db: &Db, task_id: &str) -> AelResult<FinalizeResult> {
    let task = db.get_task(task_id)?;
    let events = db.list_events(task_id)?;

    // 经验的产地(保鲜期依据):取任务记录的 agent,以及其最近会话的模型/版本。
    let (origin_agent, origin_model) = origin_of(db, &task);

    let draft_failures = extract_failures(db, &task, &events, &origin_agent, &origin_model)?;
    let draft_skills = extract_skill(db, &task, &events, &origin_agent, &origin_model)?;

    // 出口①/④:编译 Brief 与 ADR。
    let brief = brief::compile(db, task_id)?;
    let adrs = adr::compile(db, task_id)?;

    Ok(FinalizeResult {
        task,
        draft_skills,
        draft_failures,
        brief,
        adrs,
    })
}

/// 产地:origin_agent = task.agent_id 或最近会话的 agent_id;origin_model 尽力从会话命令行推断。
fn origin_of(db: &Db, task: &Task) -> (Option<String>, Option<String>) {
    let sessions = db
        .list_agent_sessions(Some(task.id.clone()), None)
        .unwrap_or_default();
    let latest = sessions.first();
    let agent = task
        .agent_id
        .clone()
        .or_else(|| latest.map(|s| s.agent_id.clone()));
    // 没有可靠的模型字段来源,保留 None(由保鲜期在有值时才比对)。
    (agent, None)
}

/// 从 error→fix 配对提炼 Failure。已存在同 signature 则 occurrences+1(不新建)。
fn extract_failures(
    db: &Db,
    task: &Task,
    events: &[TaskEvent],
    origin_agent: &Option<String>,
    origin_model: &Option<String>,
) -> AelResult<Vec<Failure>> {
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

        let error_text = combine(&ev.summary, ev.detail.as_deref());
        let (normalized_text, signature) = normalize::normalize_and_sign(&error_text);

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
            origin_agent: origin_agent.clone(),
            origin_model: origin_model.clone(),
        };
        out.push(db.insert_failure(new)?);
    }
    Ok(out)
}

/// 仅 verified 任务产 Skill;按 source_task_id 去重(避免重复 finalize 刷草案)。
fn extract_skill(
    db: &Db,
    task: &Task,
    events: &[TaskEvent],
    origin_agent: &Option<String>,
    origin_model: &Option<String>,
) -> AelResult<Vec<Skill>> {
    if task.status != TaskStatus::Verified {
        return Ok(Vec::new());
    }
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
        origin_agent: origin_agent.clone(),
        origin_model: origin_model.clone(),
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

fn derive_guard_rule(error_summary: &str, fix_summary: &str) -> String {
    format!("遇到「{}」时:{}", error_summary.trim(), fix_summary.trim())
}

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
