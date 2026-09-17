//! 从已归一化历史中提取低风险候选。
//!
//! 这一阶段只收集证据并计算质量分，不调用模型、不写入 active 记忆。
//! 后续的模型提炼和人工确认必须保留同一组 source_messages。

use crate::db::candidates::{NewFailureCandidate, NewSkillCandidate};
use crate::db::{CandidateExtractionSummary, Db, HistoryMessage};
use crate::error::{AelError, AelResult};
use serde::Deserialize;
use std::collections::HashSet;

const ACTION_MARKERS: &[&str] = &[
    "修复", "解决", "采用", "步骤", "运行", "测试", "验证", "编译", "配置",
];
const FAILURE_MARKERS: &[&str] = &[
    "error",
    "failed",
    "failure",
    "panic",
    "exception",
    "错误",
    "失败",
    "报错",
    "异常",
];
const VERIFY_MARKERS: &[&str] = &[
    "test",
    "verify",
    "validated",
    "测试",
    "验证",
    "通过",
    "编译成功",
];

pub fn extract(db: &Db) -> AelResult<CandidateExtractionSummary> {
    let conversations = db.list_history_conversations(500, 0)?;
    let mut summary = CandidateExtractionSummary {
        skill_candidates: 0,
        failure_candidates: 0,
        skipped_low_evidence: 0,
    };

    for conversation in conversations {
        let messages = db.list_history_messages(&conversation.id)?;
        if messages.is_empty() {
            summary.skipped_low_evidence += 1;
            continue;
        }

        if let Some(skill) = build_skill_candidate(&conversation, &messages) {
            db.upsert_skill_candidate(skill)?;
            summary.skill_candidates += 1;
        }

        for failure in
            build_failure_candidates(&conversation.id, &conversation.source_session_id, &messages)
        {
            db.upsert_failure_candidate(failure)?;
            summary.failure_candidates += 1;
        }
    }
    Ok(summary)
}

/// Build a bounded, source-ID-preserving prompt for an ACP distillation pass.
/// The prompt contains normalized history only; the model is not allowed to
/// invent provenance IDs, and the resulting JSON is checked again on ingest.
pub fn build_distillation_prompt(db: &Db, conversation_id: Option<&str>) -> AelResult<String> {
    let conversations = if let Some(id) = conversation_id {
        vec![db.get_history_conversation(id)?]
    } else {
        db.list_history_conversations(30, 0)?
    };
    let mut episodes = Vec::new();
    for conversation in conversations {
        let messages = db
            .list_history_messages(&conversation.id)?
            .into_iter()
            .take(40)
            .map(|message| {
                serde_json::json!({
                    "id": message.id,
                    "sourceMessageId": message.source_message_id,
                    "role": message.role,
                    "kind": message.kind,
                    "text": truncate(&message.text, 2_400),
                    "createdAt": message.created_at,
                })
            })
            .collect::<Vec<_>>();
        episodes.push(serde_json::json!({
            "conversationId": conversation.id,
            "sourceAgent": conversation.source_agent,
            "sourceSessionId": conversation.source_session_id,
            "title": conversation.title,
            "repoPath": conversation.repo_path,
            "messages": messages,
        }));
    }
    let source = serde_json::to_string_pretty(&episodes)?;
    Ok(format!(
        "你是 AEL3 的经验提炼器。只根据下面的历史证据生成 JSON，不要写解释，不要编造任何来源 ID。\n\
输出必须是一个对象，结构严格为 {{\"skills\":[],\"failures\":[]}}。\n\
每个 skills 元素必须包含 name、trigger、scope、problem、steps、antiPatterns、verification、tags、sourceSessions、sourceMessages、sourceErrors、sourceCommits、confidence；每个 failures 元素必须包含 description、rootCause、fix、guardRule、verification、tags、sourceSessions、sourceMessages、sourceErrors、sourceCommits、confidence。\n\
sourceMessages/sourceErrors 只能填写输入中真实存在的 message.id；Skill 至少引用两条消息并给出真实验证；Failure 必须给出验证证据，否则仍可输出但会被质量门拒绝。只提炼可重复、能降低未来成本的工作流，忽略闲聊和一次性结论。\n\n<episodes>\n{source}\n</episodes>"
    ))
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DistillationDocument {
    #[serde(default, alias = "skill_candidates", alias = "skillCandidates")]
    skills: Vec<DistilledSkill>,
    #[serde(default, alias = "failure_candidates", alias = "failureCandidates")]
    failures: Vec<DistilledFailure>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DistilledSkill {
    name: String,
    #[serde(default, alias = "trigger_text", alias = "triggerText")]
    trigger: String,
    #[serde(default)]
    scope: String,
    #[serde(default)]
    problem: String,
    #[serde(default)]
    steps: Vec<String>,
    #[serde(default, alias = "anti_patterns", alias = "antiPatterns")]
    anti_patterns: Vec<String>,
    #[serde(default)]
    verification: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default, alias = "source_sessions", alias = "sourceSessions")]
    source_sessions: Vec<String>,
    #[serde(default, alias = "source_messages", alias = "sourceMessages")]
    source_messages: Vec<String>,
    #[serde(default, alias = "source_errors", alias = "sourceErrors")]
    source_errors: Vec<String>,
    #[serde(default, alias = "source_commits", alias = "sourceCommits")]
    source_commits: Vec<String>,
    confidence: Option<f64>,
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct DistilledFailure {
    #[serde(default)]
    description: String,
    #[serde(default)]
    normalized_text: Option<String>,
    #[serde(default)]
    root_cause: Option<String>,
    #[serde(default)]
    fix: Option<String>,
    #[serde(default, alias = "guard_rule", alias = "guardRule")]
    guard_rule: String,
    #[serde(default)]
    verification: Vec<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default, alias = "source_sessions", alias = "sourceSessions")]
    source_sessions: Vec<String>,
    #[serde(default, alias = "source_messages", alias = "sourceMessages")]
    source_messages: Vec<String>,
    #[serde(default, alias = "source_errors", alias = "sourceErrors")]
    source_errors: Vec<String>,
    #[serde(default, alias = "source_commits", alias = "sourceCommits")]
    source_commits: Vec<String>,
    confidence: Option<f64>,
}

/// Ingest a model-produced JSON distillation after applying AEL's deterministic
/// quality gate. Model IDs and signatures are never trusted for provenance or
/// deduplication; source message IDs and normalized error text are authoritative.
pub fn ingest_model_json(
    db: &Db,
    created_by_agent: &str,
    raw: &str,
) -> AelResult<CandidateExtractionSummary> {
    let document = parse_distillation(raw)?;
    let valid_messages = history_message_ids(db)?;
    let mut summary = CandidateExtractionSummary {
        skill_candidates: 0,
        failure_candidates: 0,
        skipped_low_evidence: 0,
    };

    for skill in document.skills {
        let source_messages = valid_ids(&skill.source_messages, &valid_messages);
        let verification = clean_list(&skill.verification, 800);
        let steps = clean_list(&skill.steps, 1_200);
        let name = clean_text(&skill.name, 160);
        let trigger = clean_text(&skill.trigger, 400);
        let problem = clean_text(&skill.problem, 800);
        if source_messages.len() < 2
            || verification.is_empty()
            || name.is_empty()
            || trigger.is_empty()
            || problem.is_empty()
            || steps.is_empty()
        {
            summary.skipped_low_evidence += 1;
            continue;
        }
        let quality = skill_quality(&source_messages, &verification, &steps, &trigger);
        let confidence = skill
            .confidence
            .unwrap_or(quality)
            .clamp(0.0, 1.0)
            .min(quality);
        let seed = format!("skill|{}|{}|{}", name, problem, source_messages.join("|"));
        db.upsert_skill_candidate(NewSkillCandidate {
            id: Db::new_candidate_id("skill-candidate", &seed),
            name,
            trigger_text: trigger,
            scope: clean_text(&skill.scope, 400),
            problem,
            steps,
            anti_patterns: clean_list(&skill.anti_patterns, 800),
            verification,
            tags: clean_list(&skill.tags, 80),
            source_sessions: clean_list(&skill.source_sessions, 160),
            source_messages,
            source_errors: clean_list(&skill.source_errors, 160),
            source_commits: clean_list(&skill.source_commits, 160),
            confidence,
            created_by_agent: Some(created_by_agent.to_string()),
        })?;
        summary.skill_candidates += 1;
    }

    for failure in document.failures {
        let source_messages = valid_ids(&failure.source_messages, &valid_messages);
        let description = clean_text(&failure.description, 800);
        let verification = clean_list(&failure.verification, 800);
        if source_messages.is_empty() || description.is_empty() {
            summary.skipped_low_evidence += 1;
            continue;
        }
        let normalized_source = failure
            .normalized_text
            .as_deref()
            .filter(|text| !text.trim().is_empty())
            .unwrap_or(&description);
        let (normalized_text, signature) =
            crate::engine::normalize::normalize_and_sign(normalized_source);
        let quality = failure_quality(
            &source_messages,
            &verification,
            failure.fix.as_deref(),
            &failure.guard_rule,
        );
        let confidence = failure
            .confidence
            .unwrap_or(quality)
            .clamp(0.0, 1.0)
            .min(quality);
        db.upsert_failure_candidate(NewFailureCandidate {
            id: Db::new_candidate_id("failure-candidate", &signature),
            signature,
            normalized_text,
            description,
            root_cause: clean_optional(failure.root_cause.as_deref(), 600),
            fix: clean_optional(failure.fix.as_deref(), 800),
            guard_rule: clean_text(&failure.guard_rule, 240),
            verification,
            tags: clean_list(&failure.tags, 80),
            source_sessions: clean_list(&failure.source_sessions, 160),
            source_messages,
            source_errors: clean_list(&failure.source_errors, 160),
            source_commits: clean_list(&failure.source_commits, 160),
            confidence,
            created_by_agent: Some(created_by_agent.to_string()),
        })?;
        summary.failure_candidates += 1;
    }
    Ok(summary)
}

fn parse_distillation(raw: &str) -> AelResult<DistillationDocument> {
    let text = raw.trim();
    let start = text
        .find('{')
        .ok_or_else(|| AelError::invalid_input("ACP 提炼结果缺少 JSON 对象"))?;
    let end = text
        .rfind('}')
        .ok_or_else(|| AelError::invalid_input("ACP 提炼结果 JSON 不完整"))?;
    serde_json::from_str(&text[start..=end])
        .map_err(|error| AelError::invalid_input(format!("ACP 提炼 JSON 无法解析: {error}")))
}

fn history_message_ids(db: &Db) -> AelResult<HashSet<String>> {
    let mut ids = HashSet::new();
    for conversation in db.list_history_conversations(500, 0)? {
        for message in db.list_history_messages(&conversation.id)? {
            ids.insert(message.id);
        }
    }
    Ok(ids)
}

fn valid_ids(values: &[String], valid: &HashSet<String>) -> Vec<String> {
    values
        .iter()
        .map(|value| value.trim())
        .filter(|value| valid.contains(*value))
        .map(str::to_string)
        .collect()
}

fn clean_text(value: &str, max_chars: usize) -> String {
    value.trim().chars().take(max_chars).collect()
}

fn clean_optional(value: Option<&str>, max_chars: usize) -> Option<String> {
    value
        .map(|text| clean_text(text, max_chars))
        .filter(|text| !text.is_empty())
}

fn clean_list(values: &[String], max_chars: usize) -> Vec<String> {
    values
        .iter()
        .map(|value| clean_text(value, max_chars))
        .filter(|value| !value.is_empty())
        .take(16)
        .collect()
}

fn skill_quality(
    source_messages: &[String],
    verification: &[String],
    steps: &[String],
    trigger: &str,
) -> f64 {
    (0.2 + (source_messages.len().min(4) as f64 * 0.08)
        + 0.2
        + (steps.len().min(4) as f64 * 0.06)
        + (verification.len().min(3) as f64 * 0.05)
        + if trigger.len() >= 12 { 0.12 } else { 0.0 })
    .min(0.9)
}

fn failure_quality(
    source_messages: &[String],
    verification: &[String],
    fix: Option<&str>,
    guard_rule: &str,
) -> f64 {
    (0.2 + (source_messages.len().min(3) as f64 * 0.1)
        + if !verification.is_empty() { 0.3 } else { 0.0 }
        + if fix.is_some_and(|value| !value.trim().is_empty()) {
            0.1
        } else {
            0.0
        }
        + if guard_rule.trim().len() >= 8 {
            0.05
        } else {
            0.0
        })
    .min(0.9)
}

fn build_skill_candidate(
    conversation: &crate::db::HistoryConversation,
    messages: &[HistoryMessage],
) -> Option<NewSkillCandidate> {
    let assistant = messages
        .iter()
        .filter(|message| matches!(message.role.as_str(), "assistant" | "agent" | "model"))
        .filter(|message| message.text.chars().count() >= 80)
        .max_by_key(|message| message.text.chars().count())?;
    let lower = assistant.text.to_lowercase();
    let marker_count = ACTION_MARKERS
        .iter()
        .filter(|marker| lower.contains(&marker.to_lowercase()))
        .count();
    if marker_count < 2 {
        return None;
    }

    let verification = VERIFY_MARKERS
        .iter()
        .filter(|marker| lower.contains(&marker.to_lowercase()))
        .map(|marker| format!("文本出现验证信号：{marker}"))
        .take(3)
        .collect::<Vec<_>>();
    let source_messages = messages
        .iter()
        .filter(|message| {
            matches!(
                message.role.as_str(),
                "user" | "assistant" | "agent" | "model"
            )
        })
        .map(|message| message.id.clone())
        .take(12)
        .collect::<Vec<_>>();
    if source_messages.len() < 2 {
        return None;
    }

    let confidence = (0.35
        + (marker_count.min(5) as f64) * 0.08
        + if verification.is_empty() { 0.0 } else { 0.15 })
    .min(0.85);
    Some(NewSkillCandidate {
        id: Db::new_candidate_id(
            "skill-candidate",
            &format!("{}|{}", conversation.id, assistant.id),
        ),
        name: format!("{}：可复用工作流", truncate(&conversation.title, 50)),
        trigger_text: format!(
            "当任务与“{}”相似且需要执行步骤时，先人工审阅此候选。",
            truncate(&conversation.title, 80)
        ),
        scope: conversation.repo_path.clone().unwrap_or_default(),
        problem: conversation.title.clone(),
        steps: vec![truncate(&assistant.text, 1200)],
        anti_patterns: vec!["候选未经人工确认前不得注入 active 记忆".into()],
        verification,
        tags: vec![conversation.source_agent.clone()],
        source_sessions: vec![conversation.source_session_id.clone()],
        source_messages,
        source_errors: Vec::new(),
        source_commits: Vec::new(),
        confidence,
        created_by_agent: Some("deterministic-history-extractor".into()),
    })
}

fn build_failure_candidates(
    _conversation_id: &str,
    source_session_id: &str,
    messages: &[HistoryMessage],
) -> Vec<NewFailureCandidate> {
    messages
        .iter()
        .filter(|message| {
            message.kind == "error"
                || FAILURE_MARKERS
                    .iter()
                    .any(|marker| message.text.to_lowercase().contains(&marker.to_lowercase()))
        })
        .filter(|message| message.text.trim().chars().count() >= 6)
        .map(|message| {
            let (normalized, signature) =
                crate::engine::normalize::normalize_and_sign(&message.text);
            let candidate_id = Db::new_candidate_id("failure-candidate", &signature);
            let verification = messages
                .iter()
                .filter(|candidate| {
                    candidate.kind == "verification"
                        || VERIFY_MARKERS.iter().any(|marker| {
                            candidate
                                .text
                                .to_lowercase()
                                .contains(&marker.to_lowercase())
                        })
                })
                .map(|candidate| truncate(&candidate.text, 400))
                .take(3)
                .collect::<Vec<_>>();
            let confidence = if verification.is_empty() { 0.35 } else { 0.65 };
            NewFailureCandidate {
                id: candidate_id,
                signature,
                normalized_text: normalized.clone(),
                description: truncate(&message.text, 600),
                root_cause: None,
                fix: None,
                guard_rule: truncate(&message.text, 180),
                verification,
                tags: vec![message.kind.clone()],
                source_sessions: vec![source_session_id.to_string()],
                source_messages: vec![message.id.clone()],
                source_errors: vec![message.id.clone()],
                source_commits: Vec::new(),
                confidence,
                created_by_agent: Some("deterministic-history-extractor".into()),
            }
        })
        .collect()
}

fn truncate(value: &str, max: usize) -> String {
    let mut out = value.chars().take(max).collect::<String>();
    if value.chars().count() > max {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::ingest_model_json;
    use crate::db::history::{HistoryConversationInput, HistoryMessageInput};
    use crate::state::AppState;

    #[test]
    fn model_json_requires_real_source_messages() {
        let root = std::env::temp_dir().join(format!(
            "ael3-candidate-test-{}-{}",
            std::process::id(),
            crate::util::new_id()
        ));
        let state = AppState::open_at(root.clone()).expect("open isolated db");
        state
            .db
            .replace_history_conversation(&HistoryConversationInput {
                id: "conversation-1".into(),
                source_agent: "codex".into(),
                source_path: "D:/history/session.jsonl".into(),
                source_session_id: "session-1".into(),
                title: "candidate test".into(),
                repo_path: None,
                created_at: "2026-01-01T00:00:00Z".into(),
                updated_at: "2026-01-01T00:01:00Z".into(),
                source_hash: "hash".into(),
                messages: vec![
                    HistoryMessageInput {
                        id: "message-1".into(),
                        source_message_id: Some("source-1".into()),
                        role: "user".into(),
                        kind: "prompt".into(),
                        text: "请修复构建问题".into(),
                        created_at: "2026-01-01T00:00:00Z".into(),
                        span_start: None,
                        span_end: None,
                        tool_name: None,
                        payload_json: None,
                    },
                    HistoryMessageInput {
                        id: "message-2".into(),
                        source_message_id: Some("source-2".into()),
                        role: "assistant".into(),
                        kind: "text".into(),
                        text: "已修复并运行测试验证通过".into(),
                        created_at: "2026-01-01T00:01:00Z".into(),
                        span_start: None,
                        span_end: None,
                        tool_name: None,
                        payload_json: None,
                    },
                ],
            })
            .expect("write history");

        let accepted = ingest_model_json(
            &state.db,
            "codex",
            r#"{"skills":[{"name":"构建验证","trigger":"构建失败时执行","scope":"repo","problem":"构建问题","steps":["修复","运行测试"],"antiPatterns":[],"verification":["测试通过"],"tags":[],"sourceSessions":["session-1"],"sourceMessages":["message-1","message-2"],"sourceErrors":[],"sourceCommits":[],"confidence":0.9}],"failures":[]}"#,
        )
        .expect("valid model JSON");
        assert_eq!(accepted.skill_candidates, 1);

        let rejected = ingest_model_json(
            &state.db,
            "codex",
            r#"{"skills":[{"name":"伪造来源","trigger":"构建失败时执行","scope":"repo","problem":"构建问题","steps":["修复"],"antiPatterns":[],"verification":["测试通过"],"tags":[],"sourceSessions":[],"sourceMessages":["not-a-real-message","message-2"],"sourceErrors":[],"sourceCommits":[],"confidence":1.0}],"failures":[]}"#,
        )
        .expect("invalid source is still valid JSON");
        assert_eq!(rejected.skill_candidates, 0);
        assert_eq!(rejected.skipped_low_evidence, 1);

        let _ = std::fs::remove_dir_all(root);
    }
}
