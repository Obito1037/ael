//! ★ Codex 地盘 —— 多 Agent 输出适配。
//! 把各 Agent 的原始输出标准化为统一结构,并通过 db 落成证据链。
//! 这是「Agent 跑完 → 证据入库 → engine 提炼」链路的入口。
//! 扩展新 Agent:实现 OutputAdapter,在 `adapter_for` 注册一行即可。

pub mod claude_code;
pub mod codex;
pub mod types;

use crate::db::Db;
use crate::error::AelResult;
use crate::models::{NewEvent, TaskEvent};
use claude_code::ClaudeCodeAdapter;
use codex::CodexAdapter;
use types::OutputAdapter;

/// 按 agent_id 选 adapter;未知来源回退到 Claude Code 解析口径。
pub fn adapter_for(agent_id: &str) -> Box<dyn OutputAdapter> {
    match agent_id {
        "codex" => Box::new(CodexAdapter),
        _ => Box::new(ClaudeCodeAdapter),
    }
}

/// 把某 Agent 的原始输出解析 → 归一 → 按序写入指定任务的证据链。
/// 返回落库后的 TaskEvent(已带 db 分配的 seq/id),供调用方回显或断言。
/// v2:自动生成的证据 actor=ai,并携带来源 session_id(责任切分 + Blame 用)。
pub fn ingest(
    db: &Db,
    task_id: &str,
    agent_id: &str,
    session_id: Option<&str>,
    raw: &str,
) -> AelResult<Vec<TaskEvent>> {
    let run = adapter_for(agent_id).parse(raw);
    let mut written = Vec::with_capacity(run.events.len());
    for ev in run.events {
        let stored = db.append_event(NewEvent {
            task_id: task_id.to_string(),
            kind: ev.kind,
            summary: ev.summary,
            detail: ev.detail,
            evidence_ref: ev.evidence_ref,
            actor: crate::models::EventActor::Ai,
            session_id: session_id.map(|s| s.to_string()),
            anchor_file: None,
            anchor_lines: None,
        })?;
        written.push(stored);
    }
    Ok(written)
}
