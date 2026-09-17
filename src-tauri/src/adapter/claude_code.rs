//! ★ Codex 地盘 —— Claude Code 输出 → 统一结构。

use super::types::{parse_lines, OutputAdapter, ParsedRun};

pub struct ClaudeCodeAdapter;

impl OutputAdapter for ClaudeCodeAdapter {
    fn agent_id(&self) -> &'static str {
        "claude_code"
    }

    fn parse(&self, raw: &str) -> ParsedRun {
        ParsedRun {
            agent_id: self.agent_id().to_string(),
            events: parse_lines(raw),
        }
    }
}
