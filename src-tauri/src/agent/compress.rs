//! 上下文压缩。三种模式:
//!   summary —— 长输出抽取式摘要(去 ANSI/去重/保留 error/decision/命令/尾部)
//!   budget  —— 压到目标 token 预算(头+尾保留,中间省略)
//!   handover —— 压成接手注入(在命令层用 generate_handover_prompt 实现)
//! MVP 为规则式,签名稳定,后续可换本地小模型。

use crate::agent::usage::estimate_tokens;
use crate::error::{AelError, AelResult};
use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompressMode {
    Summary,
    Budget,
    Handover,
}

impl CompressMode {
    pub fn parse(s: &str) -> AelResult<Self> {
        match s {
            "summary" => Ok(Self::Summary),
            "budget" => Ok(Self::Budget),
            "handover" => Ok(Self::Handover),
            other => Err(AelError::invalid_input(format!(
                "未知 compress mode: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressResult {
    pub compressed: String,
    pub tokens_before: u64,
    pub tokens_after: u64,
}

/// summary / budget 的纯文本压缩。handover 模式由命令层处理(需要 db + settings)。
pub fn compress_text(input: &str, mode: CompressMode, token_budget: Option<u64>) -> CompressResult {
    let before = estimate_tokens(input);
    let compressed = match mode {
        CompressMode::Summary => summarize(input),
        CompressMode::Budget => budget_trim(input, token_budget.unwrap_or(2000)),
        CompressMode::Handover => input.to_string(), // 占位:命令层会改用接手 Prompt
    };
    let after = estimate_tokens(&compressed);
    CompressResult {
        compressed,
        tokens_before: before,
        tokens_after: after,
    }
}

fn strip_ansi(s: &str) -> String {
    static R: OnceLock<Regex> = OnceLock::new();
    let re = R.get_or_init(|| Regex::new(r"\x1b\[[0-9;?]*[ -/]*[@-~]").unwrap());
    re.replace_all(s, "").into_owned()
}

const TAIL_KEEP: usize = 30;
const MAX_KEPT_LINES: usize = 200;

fn summarize(input: &str) -> String {
    let clean = strip_ansi(input);
    let lines: Vec<String> = clean.lines().map(|l| l.trim_end().to_string()).collect();

    // 去除连续重复行
    let mut dedup: Vec<String> = Vec::with_capacity(lines.len());
    for l in lines {
        if dedup.last().map(|p| p == &l).unwrap_or(false) {
            continue;
        }
        dedup.push(l);
    }

    let markers = [
        "error",
        "错误",
        "fail",
        "panic",
        "exception",
        "fix",
        "修复",
        "warn",
        "decision",
        "决策",
        "$",
        "#",
        "npm",
        "pnpm",
        "cargo",
        "git",
        "build",
        "test",
    ];
    let total = dedup.len();
    let mut kept: Vec<String> = Vec::new();
    for (i, l) in dedup.iter().enumerate() {
        if l.trim().is_empty() {
            continue;
        }
        let near_end = i + TAIL_KEEP >= total;
        let low = l.to_lowercase();
        if near_end || markers.iter().any(|m| low.contains(m)) {
            kept.push(l.clone());
        }
    }
    if kept.len() > MAX_KEPT_LINES {
        kept = kept.split_off(kept.len() - MAX_KEPT_LINES);
    }
    format!("# 会话上下文摘要(自动压缩)\n{}", kept.join("\n"))
}

fn budget_trim(input: &str, budget_tokens: u64) -> String {
    let clean = strip_ansi(input);
    let max_chars = (budget_tokens.max(1) * 4) as usize;
    let chars: Vec<char> = clean.chars().collect();
    if chars.len() <= max_chars {
        return clean;
    }
    let head = max_chars * 2 / 3;
    let tail = max_chars - head;
    let omitted = chars.len() - max_chars;
    let h: String = chars[..head].iter().collect();
    let t: String = chars[chars.len() - tail..].iter().collect();
    format!("{h}\n…(已省略约 {omitted} 字符)…\n{t}")
}
