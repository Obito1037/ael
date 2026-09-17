//! Cross-agent history index persistence.
//!
//! This layer owns only AEL's normalized copy. Source conversation files are
//! never edited by these operations.

use super::Db;
use crate::error::{AelError, AelResult};
use crate::util::{new_id, now_iso};
use rusqlite::{params, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryConversation {
    pub id: String,
    pub source_agent: String,
    pub source_path: String,
    pub source_session_id: String,
    pub title: String,
    pub repo_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub message_count: i64,
    pub source_hash: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryMessage {
    pub id: String,
    pub conversation_id: String,
    pub source_message_id: Option<String>,
    pub role: String,
    pub kind: String,
    pub text: String,
    pub created_at: String,
    pub span_start: Option<i64>,
    pub span_end: Option<i64>,
    pub tool_name: Option<String>,
    pub payload_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistorySourceCount {
    pub source_agent: String,
    pub sessions: i64,
    pub messages: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryScanSummary {
    pub id: String,
    pub started_at: String,
    pub ended_at: String,
    pub files_seen: i64,
    pub conversations: i64,
    pub messages: i64,
    pub source_counts: BTreeMap<String, HistorySourceCount>,
    pub new_candidates: i64,
}

#[derive(Debug, Clone)]
pub(crate) struct HistoryConversationInput {
    pub id: String,
    pub source_agent: String,
    pub source_path: String,
    pub source_session_id: String,
    pub title: String,
    pub repo_path: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub source_hash: String,
    pub messages: Vec<HistoryMessageInput>,
}

#[derive(Debug, Clone)]
pub(crate) struct HistoryMessageInput {
    pub id: String,
    pub source_message_id: Option<String>,
    pub role: String,
    pub kind: String,
    pub text: String,
    pub created_at: String,
    pub span_start: Option<i64>,
    pub span_end: Option<i64>,
    pub tool_name: Option<String>,
    pub payload_json: Option<String>,
}

fn map_conversation(row: &Row<'_>) -> rusqlite::Result<HistoryConversation> {
    Ok(HistoryConversation {
        id: row.get(0)?,
        source_agent: row.get(1)?,
        source_path: row.get(2)?,
        source_session_id: row.get(3)?,
        title: row.get(4)?,
        repo_path: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        message_count: row.get(8)?,
        source_hash: row.get(9)?,
    })
}

fn map_message(row: &Row<'_>) -> rusqlite::Result<HistoryMessage> {
    Ok(HistoryMessage {
        id: row.get(0)?,
        conversation_id: row.get(1)?,
        source_message_id: row.get(2)?,
        role: row.get(3)?,
        kind: row.get(4)?,
        text: row.get(5)?,
        created_at: row.get(6)?,
        span_start: row.get(7)?,
        span_end: row.get(8)?,
        tool_name: row.get(9)?,
        payload_json: row.get(10)?,
    })
}

const CONVERSATION_COLS: &str =
    "id,source_agent,source_path,source_session_id,title,repo_path,created_at,updated_at,message_count,source_hash";
const MESSAGE_COLS: &str =
    "id,conversation_id,source_message_id,role,kind,text,created_at,span_start,span_end,tool_name,payload_json";

impl Db {
    /// Replace the normalized representation of one source conversation.
    pub(crate) fn replace_history_conversation(
        &self,
        input: &HistoryConversationInput,
    ) -> AelResult<HistoryConversation> {
        if input.source_agent.trim().is_empty() || input.source_path.trim().is_empty() {
            return Err(AelError::invalid_input(
                "history conversation requires source_agent and source_path",
            ));
        }
        let mut conn = self.lock();
        let tx = conn.transaction()?;
        tx.execute(
            "DELETE FROM history_conversations WHERE source_agent=?1 AND source_path=?2 AND source_session_id=?3",
            params![input.source_agent, input.source_path, input.source_session_id],
        )?;
        tx.execute(
            "INSERT INTO history_conversations
             (id,source_agent,source_path,source_session_id,title,repo_path,created_at,updated_at,message_count,source_hash)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                input.id,
                input.source_agent,
                input.source_path,
                input.source_session_id,
                input.title,
                input.repo_path,
                input.created_at,
                input.updated_at,
                input.messages.len() as i64,
                input.source_hash,
            ],
        )?;
        for message in &input.messages {
            tx.execute(
                "INSERT INTO history_messages
                 (id,conversation_id,source_message_id,role,kind,text,created_at,span_start,span_end,tool_name,payload_json)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                params![
                    message.id,
                    input.id,
                    message.source_message_id,
                    message.role,
                    message.kind,
                    message.text,
                    message.created_at,
                    message.span_start,
                    message.span_end,
                    message.tool_name,
                    message.payload_json,
                ],
            )?;
        }
        tx.commit()?;
        // transaction 提交后必须先释放连接互斥锁，再调用会重新加锁的查询函数。
        drop(conn);
        self.get_history_conversation(&input.id)
    }

    pub(crate) fn record_history_scan(&self, summary: &HistoryScanSummary) -> AelResult<()> {
        let source_counts = serde_json::to_string(&summary.source_counts)?;
        let conn = self.lock();
        conn.execute(
            "INSERT INTO history_scan_runs
             (id,started_at,ended_at,files_seen,conversations,messages,source_counts,new_candidates)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                summary.id,
                summary.started_at,
                summary.ended_at,
                summary.files_seen,
                summary.conversations,
                summary.messages,
                source_counts,
                summary.new_candidates,
            ],
        )?;
        Ok(())
    }

    pub fn latest_history_scan(&self) -> AelResult<Option<HistoryScanSummary>> {
        let conn = self.lock();
        let value = conn
            .query_row(
                "SELECT id,started_at,ended_at,files_seen,conversations,messages,source_counts,new_candidates
                 FROM history_scan_runs ORDER BY ended_at DESC LIMIT 1",
                [],
                |row| {
                    let raw: String = row.get(6)?;
                    Ok(HistoryScanSummary {
                        id: row.get(0)?,
                        started_at: row.get(1)?,
                        ended_at: row.get(2)?,
                        files_seen: row.get(3)?,
                        conversations: row.get(4)?,
                        messages: row.get(5)?,
                        source_counts: serde_json::from_str(&raw).unwrap_or_default(),
                        new_candidates: row.get(7)?,
                    })
                },
            )
            .optional()?;
        Ok(value)
    }

    pub fn list_history_conversations(
        &self,
        limit: i64,
        offset: i64,
    ) -> AelResult<Vec<HistoryConversation>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {CONVERSATION_COLS} FROM history_conversations
             ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2"
        ))?;
        let rows = stmt.query_map(
            params![limit.clamp(1, 500), offset.max(0)],
            map_conversation,
        )?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub fn get_history_conversation(&self, id: &str) -> AelResult<HistoryConversation> {
        let conn = self.lock();
        conn.query_row(
            &format!("SELECT {CONVERSATION_COLS} FROM history_conversations WHERE id=?1"),
            params![id],
            map_conversation,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AelError::not_found(format!("history conversation {id} 不存在"))
            }
            other => other.into(),
        })
    }

    pub fn list_history_messages(&self, conversation_id: &str) -> AelResult<Vec<HistoryMessage>> {
        let conn = self.lock();
        let mut stmt = conn.prepare(&format!(
            "SELECT {MESSAGE_COLS} FROM history_messages
             WHERE conversation_id=?1 ORDER BY COALESCE(span_start, 9223372036854775807), created_at, id"
        ))?;
        let rows = stmt.query_map(params![conversation_id], map_message)?;
        let mut out = Vec::new();
        for row in rows {
            out.push(row?);
        }
        Ok(out)
    }

    pub(crate) fn next_history_id(seed: &str) -> String {
        format!("hist-{}", stable_hash(seed))
    }

    pub(crate) fn next_history_message_id(seed: &str) -> String {
        format!("hist-msg-{}", stable_hash(seed))
    }

    pub(crate) fn new_history_scan_id() -> String {
        format!("scan-{}", new_id())
    }
}

pub(crate) fn stable_hash(value: &str) -> String {
    use sha1::{Digest, Sha1};
    let mut hasher = Sha1::new();
    hasher.update(value.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub(crate) fn fallback_time() -> String {
    now_iso()
}
