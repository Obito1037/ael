//! 会话 token 用量:**按真实 I/O(已落库的 transcript)估算**,不让前端瞎算。
//! 优先解析 agent 自己打印的用量行(agent_reported),否则按 transcript 估算。

use crate::agent::TerminalDirection;
use crate::db::Db;
use crate::error::AelResult;
use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionTokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
    /// "agent_reported"(从输出里解析到用量)| "transcript_estimate"(按真实 I/O 估算)
    pub source: String,
}

/// 与 context.rs 保持一致的粗估:约 4 字符 / token。
pub fn estimate_tokens(text: &str) -> u64 {
    ((text.chars().count() as f64) / 4.0).ceil() as u64
}

/// 拼出会话真实 I/O 文本(input + output,不含 system 噪声),供压缩/估算复用。
pub fn transcript_text(db: &Db, session_id: &str) -> AelResult<String> {
    let chunks = db.list_terminal_chunks(session_id, None)?;
    let mut s = String::new();
    for c in chunks {
        if matches!(c.direction, TerminalDirection::Input | TerminalDirection::Output) {
            s.push_str(&c.text);
            s.push('\n');
        }
    }
    Ok(s)
}

pub fn session_token_usage(db: &Db, session_id: &str) -> AelResult<SessionTokenUsage> {
    let chunks = db.list_terminal_chunks(session_id, None)?;
    let mut input = String::new();
    let mut output = String::new();
    for c in &chunks {
        match c.direction {
            TerminalDirection::Input => {
                input.push_str(&c.text);
                input.push('\n');
            }
            TerminalDirection::Output => {
                output.push_str(&c.text);
                output.push('\n');
            }
            TerminalDirection::System => {}
        }
    }

    // 优先:agent 在输出里自报用量(input + output 都解析到才采信)
    if let Some((i, o)) = parse_reported(&output) {
        return Ok(SessionTokenUsage {
            input_tokens: i,
            output_tokens: o,
            total_tokens: i + o,
            source: "agent_reported".into(),
        });
    }

    let i = estimate_tokens(&input);
    let o = estimate_tokens(&output);
    Ok(SessionTokenUsage {
        input_tokens: i,
        output_tokens: o,
        total_tokens: i + o,
        source: "transcript_estimate".into(),
    })
}

/// 从输出文本里尽力解析 `input tokens: N` / `output_tokens=N` 这类用量行,取最后一次出现。
fn parse_reported(text: &str) -> Option<(u64, u64)> {
    static IN: OnceLock<Regex> = OnceLock::new();
    static OUT: OnceLock<Regex> = OnceLock::new();
    let re_in = IN.get_or_init(|| Regex::new(r"(?i)input[ _-]?tokens?\D{0,8}(\d[\d,]*)").unwrap());
    let re_out =
        OUT.get_or_init(|| Regex::new(r"(?i)output[ _-]?tokens?\D{0,8}(\d[\d,]*)").unwrap());

    let pi = re_in
        .captures_iter(text)
        .last()
        .and_then(|c| c.get(1))
        .map(|m| clean_num(m.as_str()));
    let po = re_out
        .captures_iter(text)
        .last()
        .and_then(|c| c.get(1))
        .map(|m| clean_num(m.as_str()));
    match (pi, po) {
        (Some(i), Some(o)) => Some((i, o)),
        _ => None,
    }
}

fn clean_num(s: &str) -> u64 {
    s.replace(',', "").parse().unwrap_or(0)
}
