//! ★ Codex 地盘 —— 适配层统一数据类型 + 行级事件分类。
//! 把不同 Agent 的输出标准化成统一的「证据事件草案」,供 db 落库、engine 提炼。

use crate::models::EventKind;

/// 各 Agent 输出归一后的事件草案(尚未带 id/seq,落库时由 db 分配)。
#[derive(Debug, Clone)]
pub struct UnifiedEvent {
    pub kind: EventKind,
    pub summary: String,
    pub detail: Option<String>,
    pub evidence_ref: Option<String>,
}

/// 一次 Agent 运行解析出的批量事件。
#[derive(Debug, Clone, Default)]
pub struct ParsedRun {
    pub agent_id: String,
    pub events: Vec<UnifiedEvent>,
}

/// 把某 Agent 的原始输出解析成统一结构。
pub trait OutputAdapter {
    fn agent_id(&self) -> &'static str;
    fn parse(&self, raw: &str) -> ParsedRun;
}

/// 行首/关键词 → 事件类型。两个 adapter 共用,保证分类口径一致。
/// 让 error/fix 行能被 finalize 提炼成 Failure,verification 行进 Skill 的「如何验证」。
pub fn classify_kind(line: &str) -> EventKind {
    let l = line.trim().to_ascii_lowercase();
    let starts = |p: &str| l.starts_with(p) || l.starts_with(&format!("[{p}]"));
    if starts("error") || l.contains("error:") || l.contains("panicked") {
        EventKind::Error
    } else if starts("fix") || l.contains("fixed") || l.contains("resolved") {
        EventKind::Fix
    } else if starts("verify") || l.contains("verified") || l.contains("passed") || l.contains("✅")
    {
        EventKind::Verification
    } else if starts("decision") || l.contains("decided") || l.contains("chose ") {
        EventKind::Decision
    } else if starts("note") {
        EventKind::Note
    } else {
        EventKind::Step
    }
}

/// 通用行解析:非空行 → 一条事件,类型由 classify_kind 判定。
/// 形如 `summary :: detail` 的行会把 `::` 之后作为 detail。
pub(crate) fn parse_lines(raw: &str) -> Vec<UnifiedEvent> {
    raw.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|l| {
            let (summary, detail) = match l.split_once("::") {
                Some((s, d)) => (s.trim().to_string(), Some(d.trim().to_string())),
                None => (l.to_string(), None),
            };
            UnifiedEvent {
                kind: classify_kind(l),
                summary,
                detail,
                evidence_ref: None,
            }
        })
        .collect()
}
