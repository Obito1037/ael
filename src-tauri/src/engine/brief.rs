//! Review Brief 编译器(出口①):把整条证据链压成一页审阅摘要 —— 审代码变审证据。
//!
//! 「生成 5 分钟 / 审核 40 分钟」的解法不是更快读代码,而是换审阅对象。
//! 输入:一个 task 的 task_events + policy_decisions + agent_sessions。
//! 输出:结构化 ReviewBrief(供 UI 分节渲染)+ 一页 markdown(供导出 / PR bot)。

use super::normalize;
use crate::agent::usage::session_token_usage;
use crate::db::Db;
use crate::error::AelResult;
use crate::models::{
    BriefDecision, BriefErrorFixed, BriefStats, BriefVerification, EventActor, EventKind,
    ReviewBrief, TaskEvent,
};
use crate::util::now_iso;

pub fn compile(db: &Db, task_id: &str) -> AelResult<ReviewBrief> {
    let task = db.get_task(task_id)?;
    let events = db.list_events(task_id)?;
    let interceptions = db.task_interceptions(task_id)?;
    let sessions = db.list_agent_sessions(Some(task_id.to_string()), None)?;

    let decisions = collect_decisions(&events);
    let errors_fixed = collect_errors_fixed(db, &events)?;
    let verifications = collect_verifications(&events);
    let risks = collect_risks(&events, &errors_fixed, &verifications, &interceptions);

    let mut tokens_est: u64 = 0;
    for s in &sessions {
        if let Ok(u) = session_token_usage(db, &s.id) {
            tokens_est += u.total_tokens;
        }
    }
    let human_confirmed = events.iter().filter(|e| e.actor == EventActor::Human).count() as i64;
    let ai_proposed = events.iter().filter(|e| e.actor == EventActor::Ai).count() as i64;
    let duration_secs = duration_between(&task.created_at, task.closed_at.as_deref().unwrap_or(&task.updated_at));

    let stats = BriefStats {
        events: events.len() as i64,
        sessions: sessions.len() as i64,
        tokens_est,
        human_confirmed,
        ai_proposed,
        duration_secs,
    };

    let generated_at = now_iso();
    let markdown = render_markdown(
        &task.id,
        &task.title,
        &task.goal,
        task.status.as_str(),
        &generated_at,
        &decisions,
        &errors_fixed,
        &verifications,
        &interceptions,
        &risks,
        &stats,
    );

    Ok(ReviewBrief {
        task_id: task.id.clone(),
        title: task.title.clone(),
        goal: task.goal.clone(),
        status: task.status,
        generated_at,
        decisions,
        errors_fixed,
        verifications,
        interceptions,
        risks,
        stats,
        markdown,
    })
}

fn collect_decisions(events: &[TaskEvent]) -> Vec<BriefDecision> {
    events
        .iter()
        .filter(|e| e.kind == EventKind::Decision)
        .map(|e| BriefDecision {
            summary: e.summary.trim().to_string(),
            reason: e.detail.as_ref().map(|d| d.trim().to_string()).filter(|d| !d.is_empty()),
            actor: e.actor,
        })
        .collect()
}

/// error→fix 配对(与 finalize 同算法);signature 现算,recurrences 查失败库。
fn collect_errors_fixed(db: &Db, events: &[TaskEvent]) -> AelResult<Vec<BriefErrorFixed>> {
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
        let (_, signature) = normalize::normalize_and_sign(&error_text);
        let recurrences = db
            .find_failure_by_signature(&signature)?
            .map(|f| f.occurrences)
            .unwrap_or(0);
        let fix_text = fix.map(|(j, fx)| {
            fix_used[j] = true;
            combine(&fx.summary, fx.detail.as_deref())
        });
        out.push(BriefErrorFixed {
            error: ev.summary.trim().to_string(),
            fix: fix_text,
            signature: Some(signature),
            recurrences,
        });
    }
    Ok(out)
}

fn collect_verifications(events: &[TaskEvent]) -> Vec<BriefVerification> {
    events
        .iter()
        .filter(|e| e.kind == EventKind::Verification)
        .map(|e| BriefVerification {
            summary: e.summary.trim().to_string(),
            evidence_ref: e.evidence_ref.clone(),
        })
        .collect()
}

fn collect_risks(
    events: &[TaskEvent],
    errors_fixed: &[BriefErrorFixed],
    verifications: &[BriefVerification],
    interceptions: &[crate::models::PolicyDecision],
) -> Vec<String> {
    let mut risks = Vec::new();
    if verifications.is_empty() {
        risks.push("未记录任何验证证据——无法确认改动真的跑过测试。".to_string());
    }
    for ef in errors_fixed {
        if ef.fix.is_none() {
            risks.push(format!("存在未修复的错误:{}", ef.error));
        }
    }
    // 人工放行过的高危命令(海关裁决线上被放行)
    for d in interceptions {
        if matches!(d.decided_by, crate::models::DecidedBy::Human)
            && matches!(d.verdict, crate::models::PolicyVerdictKind::Approved)
        {
            risks.push(format!("人工放行过高危命令(规则 {}):{}", d.rule_id, d.command_text));
        }
    }
    // 完全没有证据的空任务
    if events.is_empty() {
        risks.push("证据链为空——该任务没有任何可审阅的过程留痕。".to_string());
    }
    risks
}

// ── markdown 渲染(一页) ──────────────────────────────────────

#[allow(clippy::too_many_arguments)]
fn render_markdown(
    task_id: &str,
    title: &str,
    goal: &str,
    status: &str,
    generated_at: &str,
    decisions: &[BriefDecision],
    errors_fixed: &[BriefErrorFixed],
    verifications: &[BriefVerification],
    interceptions: &[crate::models::PolicyDecision],
    risks: &[String],
    stats: &BriefStats,
) -> String {
    let mut m = String::new();
    m.push_str(&format!("# Review Brief · {title}\n\n"));
    m.push_str(&format!("> 任务 `{task_id}` · 状态 **{status}** · 生成于 {generated_at}\n\n"));
    m.push_str(&format!("## GOAL · 任务目标\n{}\n\n", goal.trim()));

    m.push_str("## DECISIONS · 关键决策\n");
    if decisions.is_empty() {
        m.push_str("_(无记录的决策)_\n");
    } else {
        for d in decisions {
            let who = actor_label(d.actor);
            match &d.reason {
                Some(r) => m.push_str(&format!("- **{}** — {}(_{who}_)\n", d.summary, r)),
                None => m.push_str(&format!("- **{}**(_{who}_)\n", d.summary)),
            }
        }
    }
    m.push('\n');

    m.push_str("## ERRORS · 已拦截 / 修复的错误\n");
    if errors_fixed.is_empty() {
        m.push_str("_(本任务未捕获错误)_\n");
    } else {
        for e in errors_fixed {
            let tail = match &e.fix {
                Some(f) => format!(" → 已修复:{f}"),
                None => " → ⚠ 尚未修复".to_string(),
            };
            let rec = if e.recurrences > 1 {
                format!("(历史第 {} 次,签名 {})", e.recurrences, short_sig(e.signature.as_deref()))
            } else {
                String::new()
            };
            m.push_str(&format!("- {}{}{}\n", e.error, tail, rec));
        }
    }
    m.push('\n');

    m.push_str("## VERIFY · 验证证据\n");
    if verifications.is_empty() {
        m.push_str("_(⚠ 无验证证据)_\n");
    } else {
        for v in verifications {
            match &v.evidence_ref {
                Some(r) => m.push_str(&format!("- {} `{}`\n", v.summary, r)),
                None => m.push_str(&format!("- {}\n", v.summary)),
            }
        }
    }
    m.push('\n');

    if !interceptions.is_empty() {
        m.push_str("## GATE · 海关拦截记录\n");
        for d in interceptions {
            m.push_str(&format!(
                "- `{}` — 规则 {} · {} · {}\n",
                d.command_text,
                d.rule_id,
                d.verdict.as_str(),
                d.reason
            ));
        }
        m.push('\n');
    }

    m.push_str("## RISK · 需人工关注\n");
    if risks.is_empty() {
        m.push_str("_(未发现自动可判定的风险点)_\n");
    } else {
        for r in risks {
            m.push_str(&format!("- {r}\n"));
        }
    }
    m.push('\n');

    m.push_str("## STATS\n");
    m.push_str(&format!(
        "证据 {} 条 · 会话 {} 个 · 估算 {} tokens · 人工确认 {} · AI 提议 {}",
        stats.events, stats.sessions, stats.tokens_est, stats.human_confirmed, stats.ai_proposed
    ));
    if let Some(secs) = stats.duration_secs {
        m.push_str(&format!(" · 耗时 {}", human_duration(secs)));
    }
    m.push('\n');
    m
}

// ── 小工具 ─────────────────────────────────────────────────────

fn combine(summary: &str, detail: Option<&str>) -> String {
    match detail {
        Some(d) if !d.trim().is_empty() => format!("{summary}\n{d}"),
        _ => summary.to_string(),
    }
}

fn actor_label(a: EventActor) -> &'static str {
    match a {
        EventActor::Ai => "AI 提议",
        EventActor::Human => "人工",
        EventActor::Guard => "Guard/海关",
        EventActor::System => "系统",
    }
}

fn short_sig(sig: Option<&str>) -> String {
    match sig {
        Some(s) if s.len() >= 8 => format!("{}…", &s[..8]),
        Some(s) => s.to_string(),
        None => "—".to_string(),
    }
}

/// 两个 ISO-8601 时间字符串之差(秒);解析失败返回 None。
fn duration_between(start: &str, end: &str) -> Option<i64> {
    let s = chrono::DateTime::parse_from_rfc3339(start).ok()?;
    let e = chrono::DateTime::parse_from_rfc3339(end).ok()?;
    let d = (e - s).num_seconds();
    if d >= 0 {
        Some(d)
    } else {
        None
    }
}

fn human_duration(secs: i64) -> String {
    if secs < 60 {
        format!("{secs}s")
    } else if secs < 3600 {
        format!("{}m{}s", secs / 60, secs % 60)
    } else {
        format!("{}h{}m", secs / 3600, (secs % 3600) / 60)
    }
}
