//! ★ Codex 地盘 —— Codex 输出 → 统一结构。

use super::types::{parse_lines, OutputAdapter, ParsedRun};

pub struct CodexAdapter;

impl OutputAdapter for CodexAdapter {
    fn agent_id(&self) -> &'static str {
        "codex"
    }

    fn parse(&self, raw: &str) -> ParsedRun {
        ParsedRun {
            agent_id: self.agent_id().to_string(),
            events: parse_lines(raw),
        }
    }
}
