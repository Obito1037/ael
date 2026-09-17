//! Deterministic, read-only discovery of local agent conversations.
//!
//! Adapters intentionally normalize only the stable fields needed by AEL. A
//! source file is treated as immutable input; every scan replaces only AEL's
//! copy for that source path.

pub mod candidates;

use crate::db::history::{
    fallback_time, stable_hash, HistoryConversationInput, HistoryMessageInput,
};
use crate::db::{Db, HistoryScanSummary, HistorySourceCount};
use crate::error::AelResult;
use crate::util::now_iso;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy)]
enum SourceKind {
    Claude,
    Codex,
    OpenCode,
    Gemini,
}

/// 历史来源适配器边界。Gemini 当前不假设某个私有落盘格式，先保留可插拔
/// 发现接口；实现新增格式时不会改变 Canonical Conversation 或数据库契约。
pub trait HistoryAdapter {
    fn source_agent(&self) -> &'static str;
    fn discover(&self, home: &Path) -> Vec<PathBuf>;
}

#[derive(Debug, Clone, Copy, Default)]
pub struct GeminiHistoryAdapter;

impl HistoryAdapter for GeminiHistoryAdapter {
    fn source_agent(&self) -> &'static str {
        "gemini"
    }

    fn discover(&self, _home: &Path) -> Vec<PathBuf> {
        // Gemini 的本机会话格式尚未稳定；不猜测目录，也不误读用户文件。
        Vec::new()
    }
}

const SESSION_KEYS: &[&str] = &[
    "session_id",
    "sessionId",
    "conversation_id",
    "conversationId",
    "thread_id",
    "threadId",
];

impl SourceKind {
    fn id(self) -> &'static str {
        match self {
            Self::Claude => "claude_code",
            Self::Codex => "codex",
            Self::OpenCode => "opencode",
            Self::Gemini => "gemini",
        }
    }
}

#[derive(Debug)]
struct SourceFile {
    kind: SourceKind,
    path: PathBuf,
}

/// Scan all supported local sources. No network call, API key, or LLM is used.
pub fn scan(db: &Db) -> AelResult<HistoryScanSummary> {
    let started_at = now_iso();
    let scan_id = Db::new_history_scan_id();
    let mut files = Vec::new();
    let home = home_dir();

    if let Some(home) = &home {
        collect_files(
            &home.join(".claude").join("projects"),
            SourceKind::Claude,
            &mut files,
            &BTreeSet::from(["jsonl"]),
        );
        collect_files(
            &home.join(".codex").join("sessions"),
            SourceKind::Codex,
            &mut files,
            &BTreeSet::from(["jsonl"]),
        );
    }

    let mut opencode_roots = Vec::new();
    if let Some(appdata) = std::env::var_os("APPDATA") {
        opencode_roots.push(PathBuf::from(appdata).join("opencode"));
    }
    if let Some(home) = &home {
        opencode_roots.push(home.join(".local").join("share").join("opencode"));
        opencode_roots.push(home.join(".config").join("opencode"));
    }
    for root in opencode_roots {
        collect_files(
            &root,
            SourceKind::OpenCode,
            &mut files,
            &BTreeSet::from(["jsonl", "json", "db", "sqlite", "sqlite3"]),
        );
    }

    let mut source_counts: BTreeMap<String, HistorySourceCount> = BTreeMap::new();
    for kind in [
        SourceKind::Claude,
        SourceKind::Codex,
        SourceKind::OpenCode,
        SourceKind::Gemini,
    ] {
        source_counts.insert(
            kind.id().to_string(),
            HistorySourceCount {
                source_agent: kind.id().to_string(),
                ..HistorySourceCount::default()
            },
        );
    }
    let mut conversations = 0_i64;
    let mut messages = 0_i64;

    for source in files.iter().filter(|source| !is_sqlite_path(&source.path)) {
        let Some(input) = parse_json_source(&source.kind, &source.path) else {
            continue;
        };
        let message_count = input.messages.len() as i64;
        if db.replace_history_conversation(&input).is_ok() {
            conversations += 1;
            messages += message_count;
            let entry = source_counts
                .entry(source.kind.id().to_string())
                .or_insert_with(|| HistorySourceCount {
                    source_agent: source.kind.id().to_string(),
                    ..HistorySourceCount::default()
                });
            entry.sessions += 1;
            entry.messages += message_count;
        }
    }

    // OpenCode has used SQLite in different releases. We discover database
    // files separately and read only text-bearing rows from a read-only handle.
    for source in files.iter().filter(|source| is_sqlite_path(&source.path)) {
        for input in parse_opencode_sqlite(&source.path) {
            let message_count = input.messages.len() as i64;
            if db.replace_history_conversation(&input).is_ok() {
                conversations += 1;
                messages += message_count;
                let entry = source_counts
                    .entry(SourceKind::OpenCode.id().to_string())
                    .or_insert_with(|| HistorySourceCount {
                        source_agent: SourceKind::OpenCode.id().to_string(),
                        ..HistorySourceCount::default()
                    });
                entry.sessions += 1;
                entry.messages += message_count;
            }
        }
    }

    let ended_at = now_iso();
    let summary = HistoryScanSummary {
        id: scan_id,
        started_at,
        ended_at,
        files_seen: files.len() as i64,
        conversations,
        messages,
        source_counts,
        // Candidate extraction is deliberately a separate, reviewable phase.
        new_candidates: 0,
    };
    db.record_history_scan(&summary)?;
    Ok(summary)
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}

fn collect_files(
    root: &Path,
    kind: SourceKind,
    out: &mut Vec<SourceFile>,
    extensions: &BTreeSet<&str>,
) {
    if !root.is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_files(&path, kind, out, extensions);
            continue;
        }
        let Some(ext) = path.extension().and_then(|v| v.to_str()) else {
            continue;
        };
        let ext = ext.to_ascii_lowercase();
        if extensions.contains(ext.as_str()) {
            out.push(SourceFile { kind, path });
        }
    }
}

fn is_sqlite_path(path: &Path) -> bool {
    path.extension()
        .and_then(|v| v.to_str())
        .map(|ext| {
            matches!(
                ext.to_ascii_lowercase().as_str(),
                "db" | "sqlite" | "sqlite3"
            )
        })
        .unwrap_or(false)
}

fn parse_json_source(kind: &SourceKind, path: &Path) -> Option<HistoryConversationInput> {
    let content = fs::read_to_string(path).ok()?;
    let fallback = file_time(path);
    let mut messages = Vec::new();
    let mut session_id = None;
    let mut repo_path = None;

    for (index, raw) in content.lines().enumerate() {
        let value: Value = match serde_json::from_str(raw) {
            Ok(value) => value,
            Err(_) => continue,
        };
        session_id = session_id.or_else(|| find_string(&value, SESSION_KEYS));
        repo_path = repo_path.or_else(|| find_path(&value));
        if let Some(message) = message_from_value(&value, index as i64 + 1, &fallback) {
            messages.push(message);
        }
    }

    if messages.is_empty() {
        return None;
    }
    let source_path = canonical_or_original(path);
    let source_session_id =
        session_id.unwrap_or_else(|| format!("file-{}", stable_hash(&source_path)));
    let source_hash = stable_hash(&content);
    let id = Db::next_history_id(&format!(
        "{}|{}|{}",
        kind.id(),
        source_path,
        source_session_id
    ));
    let title = messages
        .iter()
        .find(|message| message.role == "user")
        .or_else(|| messages.first())
        .map(|message| truncate(&message.text, 160))
        .unwrap_or_else(|| "未命名会话".into());
    let created_at = messages
        .first()
        .map(|message| message.created_at.clone())
        .unwrap_or_else(|| fallback.clone());

    Some(HistoryConversationInput {
        id,
        source_agent: kind.id().into(),
        source_path,
        source_session_id,
        title,
        repo_path,
        created_at,
        updated_at: fallback,
        source_hash,
        messages,
    })
}

fn message_from_value(value: &Value, line: i64, fallback: &str) -> Option<HistoryMessageInput> {
    let text = extract_text(value)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    let role =
        find_string(value, &["role", "author_role", "sender"]).unwrap_or_else(|| infer_role(value));
    let kind = infer_kind(value, &text);
    let created_at = find_string(value, &["timestamp", "created_at", "createdAt", "time"])
        .unwrap_or_else(|| fallback.to_string());
    let source_message_id = find_string(
        value,
        &[
            "message_id",
            "messageId",
            "event_id",
            "eventId",
            "uuid",
            "id",
        ],
    );
    let tool_name = find_string(value, &["tool_name", "toolName", "tool", "name"]);
    let payload_json = serde_json::to_string(value).ok();
    let source_message_id_for_hash = source_message_id
        .clone()
        .unwrap_or_else(|| line.to_string());
    Some(HistoryMessageInput {
        id: Db::next_history_message_id(&format!(
            "{}|{}|{}",
            source_message_id_for_hash, line, text
        )),
        source_message_id,
        role,
        kind,
        text,
        created_at,
        span_start: Some(line),
        span_end: Some(line),
        tool_name,
        payload_json,
    })
}

fn parse_opencode_sqlite(path: &Path) -> Vec<HistoryConversationInput> {
    let Ok(conn) = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY) else {
        return Vec::new();
    };
    let Ok(mut tables) = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    else {
        return Vec::new();
    };
    let table_names: Vec<String> = tables
        .query_map([], |row| row.get(0))
        .into_iter()
        .flatten()
        .flatten()
        .collect();
    drop(tables);

    let mut result = Vec::new();
    for table in table_names {
        let columns = table_columns(&conn, &table);
        let Some(text_col) = columns.iter().find(|column| {
            matches!(
                column.as_str(),
                "content" | "text" | "message" | "prompt" | "response" | "output" | "parts"
            )
        }) else {
            continue;
        };
        let id_col = columns
            .iter()
            .find(|column| matches!(column.as_str(), "id" | "message_id" | "session_id"))
            .cloned();
        let time_col = columns
            .iter()
            .find(|column| {
                matches!(
                    column.as_str(),
                    "created_at" | "createdAt" | "timestamp" | "time"
                )
            })
            .cloned();
        let role_col = columns
            .iter()
            .find(|column| column.as_str() == "role")
            .cloned();
        let query = format!(
            "SELECT rowid, {}, {}, {}, {} FROM {} LIMIT 10000",
            quote_ident(text_col),
            optional_column(id_col.as_deref()),
            optional_column(time_col.as_deref()),
            optional_column(role_col.as_deref()),
            quote_ident(&table)
        );
        let Ok(mut rows) = conn.prepare(&query) else {
            continue;
        };
        let mut messages = Vec::new();
        let fallback = file_time(path);
        let mapped = rows.query_map([], |row| {
            let rowid: i64 = row.get(0)?;
            let text: Option<String> = row.get(1)?;
            let id: Option<String> = row.get(2)?;
            let created: Option<String> = row.get(3)?;
            let role: Option<String> = row.get(4)?;
            Ok((rowid, text, id, created, role))
        });
        if let Ok(mapped) = mapped {
            for row in mapped.flatten() {
                let Some(text) = row.1.filter(|text| !text.trim().is_empty()) else {
                    continue;
                };
                messages.push(HistoryMessageInput {
                    id: Db::next_history_message_id(&format!(
                        "{}|{}|{}",
                        path.display(),
                        table,
                        row.0
                    )),
                    source_message_id: row.2,
                    role: row.4.unwrap_or_else(|| "unknown".into()),
                    kind: infer_kind(&Value::String(text.clone()), &text),
                    text,
                    created_at: row.3.unwrap_or_else(|| fallback.clone()),
                    span_start: Some(row.0),
                    span_end: Some(row.0),
                    tool_name: None,
                    payload_json: None,
                });
            }
        }
        if messages.is_empty() {
            continue;
        }
        let source_path = canonical_or_original(path);
        let source_session_id = format!("sqlite-{}-{}", stable_hash(&source_path), table);
        result.push(HistoryConversationInput {
            id: Db::next_history_id(&format!("opencode|{}|{}", source_path, table)),
            source_agent: SourceKind::OpenCode.id().into(),
            source_path: source_path.clone(),
            source_session_id,
            title: truncate(&messages[0].text, 160),
            repo_path: None,
            created_at: messages[0].created_at.clone(),
            updated_at: fallback,
            source_hash: stable_hash(&format!("{}|{}", source_path, table)),
            messages,
        });
    }
    result
}

fn table_columns(conn: &Connection, table: &str) -> Vec<String> {
    let query = format!("PRAGMA table_info({})", quote_ident(table));
    let Ok(mut stmt) = conn.prepare(&query) else {
        return Vec::new();
    };
    stmt.query_map([], |row| row.get(1))
        .into_iter()
        .flatten()
        .flatten()
        .collect()
}

fn optional_column(column: Option<&str>) -> String {
    column.map(quote_ident).unwrap_or_else(|| "NULL".into())
}

fn quote_ident(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn extract_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Array(items) => {
            let parts: Vec<String> = items.iter().filter_map(extract_text).collect();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        Value::Object(map) => {
            for key in [
                "text", "content", "message", "summary", "error", "output", "result", "prompt",
            ] {
                if let Some(value) = map.get(key) {
                    if let Some(text) = extract_text(value) {
                        if !text.trim().is_empty() {
                            return Some(text);
                        }
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn find_string(value: &Value, keys: &[&str]) -> Option<String> {
    match value {
        Value::Object(map) => {
            for key in keys {
                if let Some(Value::String(text)) = map.get(*key) {
                    if !text.trim().is_empty() {
                        return Some(text.clone());
                    }
                }
            }
            map.values().find_map(|child| find_string(child, keys))
        }
        Value::Array(items) => items.iter().find_map(|child| find_string(child, keys)),
        _ => None,
    }
}

fn find_path(value: &Value) -> Option<String> {
    let candidate = find_string(
        value,
        &[
            "repo_path",
            "repoPath",
            "cwd",
            "workdir",
            "projectPath",
            "project_dir",
        ],
    )?;
    let path = PathBuf::from(&candidate);
    (path.is_absolute() || candidate.contains(':')).then_some(candidate)
}

fn infer_role(value: &Value) -> String {
    let type_name = find_string(value, &["type", "kind", "event", "message_type"])
        .unwrap_or_default()
        .to_ascii_lowercase();
    if type_name.contains("user") || type_name.contains("prompt") {
        "user".into()
    } else if type_name.contains("assistant") || type_name.contains("agent") {
        "assistant".into()
    } else if type_name.contains("tool") {
        "tool".into()
    } else if type_name.contains("system") {
        "system".into()
    } else {
        "unknown".into()
    }
}

fn infer_kind(value: &Value, text: &str) -> String {
    let hint = format!(
        "{} {}",
        find_string(value, &["type", "kind", "event", "message_type"]).unwrap_or_default(),
        text
    )
    .to_ascii_lowercase();
    if hint.contains("tool_call") || hint.contains("tool-use") || hint.contains("tool use") {
        "tool_call".into()
    } else if hint.contains("tool_result")
        || hint.contains("tool-result")
        || hint.contains("tool result")
    {
        "tool_result".into()
    } else if hint.contains("error") || hint.contains("exception") || hint.contains("failed") {
        "error".into()
    } else if hint.contains("decision") || hint.contains("decided") || hint.contains("decide") {
        "decision".into()
    } else if hint.contains("verif") || hint.contains("passed") || hint.contains("success") {
        "verification".into()
    } else if hint.contains("file_change") || hint.contains("file change") || hint.contains("diff")
    {
        "file_change".into()
    } else {
        "message".into()
    }
}

fn canonical_or_original(path: &Path) -> String {
    fs::canonicalize(path)
        .unwrap_or_else(|_| path.to_path_buf())
        .to_string_lossy()
        .to_string()
}

fn file_time(path: &Path) -> String {
    path.metadata()
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| DateTime::<Utc>::from(time).to_rfc3339().into())
        .unwrap_or_else(|| fallback_time())
}

fn truncate(value: &str, max_chars: usize) -> String {
    let mut output: String = value.chars().take(max_chars).collect();
    if value.chars().count() > max_chars {
        output.push('…');
    }
    output
}

#[cfg(test)]
mod tests {
    use super::{infer_kind, infer_role, message_from_value, parse_opencode_sqlite};
    use rusqlite::Connection;
    use serde_json::json;
    use std::path::PathBuf;

    #[test]
    fn normalizes_common_agent_events_without_llm() {
        let value =
            json!({"id":"m1","role":"assistant","type":"tool_result","content":"passed tests"});
        let message = message_from_value(&value, 4, "fallback").unwrap();
        assert_eq!(message.role, "assistant");
        assert_eq!(message.kind, "tool_result");
        assert_eq!(message.source_message_id.as_deref(), Some("m1"));
    }

    #[test]
    fn falls_back_to_deterministic_role_and_kind() {
        let value = json!({"type":"user_prompt","text":"please decide"});
        assert_eq!(infer_role(&value), "user");
        assert_eq!(infer_kind(&value, "please decide"), "decision");
    }

    #[test]
    fn reads_opencode_sqlite_without_writing_source() {
        let path = std::env::temp_dir().join(format!(
            "ael3-opencode-history-{}-{}.sqlite",
            std::process::id(),
            crate::util::new_id()
        ));
        let conn = Connection::open(&path).expect("create sqlite fixture");
        conn.execute_batch(
            "CREATE TABLE messages (id TEXT, role TEXT, content TEXT, created_at TEXT);
             INSERT INTO messages VALUES ('m1','user','请修复构建','2026-01-01T00:00:00Z');
             INSERT INTO messages VALUES ('m2','assistant','verification passed: 已修复','2026-01-01T00:01:00Z');",
        )
        .expect("seed sqlite fixture");
        drop(conn);

        let conversations = parse_opencode_sqlite(&PathBuf::from(&path));
        assert_eq!(conversations.len(), 1);
        assert_eq!(conversations[0].source_agent, "opencode");
        assert_eq!(conversations[0].messages.len(), 2);
        assert_eq!(
            conversations[0].messages[0].source_message_id.as_deref(),
            Some("m1")
        );
        assert_eq!(conversations[0].messages[1].role, "assistant");
        assert_eq!(conversations[0].messages[1].kind, "verification");
        assert!(path.is_file(), "扫描不得删除或改写来源数据库");
        let _ = std::fs::remove_file(path);
    }
}
