//! 检索打分(contracts/DECISIONS.md 决策 1,retrievalMode = keyword)。
//!
//! 三信号加权:
//!   score = 0.45·标签Jaccard + 0.35·归一化BM25 + 0.20·签名命中(0/1)
//! 低于 guardMinScore 的结果不返回(宁可漏报,不把 Agent 带沟里)。
//! 升级 hybrid 时本文件内部换召回/重排即可,IPC 签名不变。

use crate::db::Db;
use crate::error::AelResult;
use crate::models::{Failure, RankedSkill, Skill, SkillStatus};
use std::collections::HashSet;

pub const W_TAG: f64 = 0.45;
pub const W_BM25: f64 = 0.35;
pub const W_SIG: f64 = 0.20;

const CANDIDATE_CAP: i64 = 500;
const FTS_CAP: i64 = 100;

/// 文本 → 去重的小写 token(长度 ≥ 2,按字母数字切分)。
pub fn tokenize(text: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            cur.extend(ch.to_lowercase());
        } else if !cur.is_empty() {
            push_token(&mut cur, &mut seen, &mut out);
        }
    }
    if !cur.is_empty() {
        push_token(&mut cur, &mut seen, &mut out);
    }
    out
}

fn push_token(cur: &mut String, seen: &mut HashSet<String>, out: &mut Vec<String>) {
    let tok = std::mem::take(cur);
    if tok.chars().count() >= 2 && seen.insert(tok.clone()) {
        out.push(tok);
    }
}

/// 标签集合 Jaccard 相似度(大小写不敏感)。两边都空记 0。
pub fn jaccard(a: &[String], b: &[String]) -> f64 {
    let sa: HashSet<String> = a.iter().map(|s| s.to_lowercase()).collect();
    let sb: HashSet<String> = b.iter().map(|s| s.to_lowercase()).collect();
    if sa.is_empty() && sb.is_empty() {
        return 0.0;
    }
    let inter = sa.intersection(&sb).count() as f64;
    let union = sa.union(&sb).count() as f64;
    if union == 0.0 {
        0.0
    } else {
        inter / union
    }
}

/// 由查询词构造安全的 FTS5 MATCH 表达式:每个 token 加引号,用 OR 连接。
/// 引号可避免把 token 误当 FTS 操作符。无有效 token 返回空串。
pub fn build_match_expr(query: &str) -> String {
    let toks = tokenize(query);
    toks.iter()
        .map(|t| format!("\"{t}\""))
        .collect::<Vec<_>>()
        .join(" OR ")
}

/// 把一组原始 bm25(负数,越小越相关)归一化到 0..1。
/// relevance = -bm25;再除以集合内最大 relevance。
fn bm25_norm(raw: &[(String, f64)]) -> std::collections::HashMap<String, f64> {
    let max_rel = raw
        .iter()
        .map(|(_, b)| -b)
        .fold(f64::MIN, f64::max)
        .max(0.0);
    raw.iter()
        .map(|(id, b)| {
            let rel = (-b).max(0.0);
            let norm = if max_rel > 0.0 { rel / max_rel } else { 0.0 };
            (id.clone(), norm)
        })
        .collect()
}

/// 检索 Skill(search_skills 命令)。query 为自由文本,签名信号恒 0。
pub fn ranked_skills(
    db: &Db,
    query: &str,
    status: Option<SkillStatus>,
    limit: i64,
    min_score: f64,
) -> AelResult<Vec<RankedSkill>> {
    let tokens = tokenize(query);
    let fts = db.fts_search_skills(&build_match_expr(query), FTS_CAP)?;
    let bm = bm25_norm(
        &fts.iter()
            .map(|(s, b)| (s.id.clone(), *b))
            .collect::<Vec<_>>(),
    );

    let candidates = db.list_skills(status, CANDIDATE_CAP, 0)?;
    let mut ranked: Vec<RankedSkill> = candidates
        .into_iter()
        .map(|skill| {
            let jac = jaccard(&tokens, &skill.tags);
            let bm25 = bm.get(&skill.id).copied().unwrap_or(0.0);
            let score = W_TAG * jac + W_BM25 * bm25;
            RankedSkill { skill, score }
        })
        .filter(|r| r.score >= min_score)
        .collect();

    ranked.sort_by(|a, b| {
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    ranked.truncate(limit.max(0) as usize);
    Ok(ranked)
}

/// Failure Guard 召回:用 goal + tags 匹配历史失败。任务开始尚无错误,签名信号 0。
pub fn matched_failures(
    db: &Db,
    goal: &str,
    tags: &[String],
    limit: i64,
    min_score: f64,
) -> AelResult<Vec<Failure>> {
    let query = format!("{} {}", goal, tags.join(" "));
    let fts = db.fts_search_failures(&build_match_expr(&query), FTS_CAP)?;
    let bm = bm25_norm(
        &fts.iter()
            .map(|(f, b)| (f.id.clone(), *b))
            .collect::<Vec<_>>(),
    );

    let candidates = db.list_failures(CANDIDATE_CAP, 0)?;
    let mut scored: Vec<(Failure, f64)> = candidates
        .into_iter()
        .map(|f| {
            let jac = jaccard(tags, &f.tags);
            let bm25 = bm.get(&f.id).copied().unwrap_or(0.0);
            let score = W_TAG * jac + W_BM25 * bm25;
            (f, score)
        })
        .filter(|(_, s)| *s >= min_score)
        .collect();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    scored.truncate(limit.max(0) as usize);
    Ok(scored.into_iter().map(|(f, _)| f).collect())
}

/// 供 guard 复用:active Skill 推荐(同 ranked_skills,但只返回 Skill)。
pub fn suggested_skills(
    db: &Db,
    goal: &str,
    tags: &[String],
    limit: i64,
    min_score: f64,
) -> AelResult<Vec<Skill>> {
    let query = format!("{} {}", goal, tags.join(" "));
    Ok(
        ranked_skills(db, &query, Some(SkillStatus::Active), limit, min_score)?
            .into_iter()
            .map(|r| r.skill)
            .collect(),
    )
}
