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
use sha1::{Digest, Sha1};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{BufRead, BufReader, Read};
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

const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_CONVERSATION_BYTES: usize = 64 * 1024 * 1024;
const MAX_CONVERSATION_MESSAGES: usize = 100_000;
const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Copy)]
struct ParseLimits {
    line_bytes: usize,
    conversation_bytes: usize,
    messages: usize,
}
const PARSE_LIMITS: ParseLimits = ParseLimits {
    line_bytes: MAX_LINE_BYTES,
    conversation_bytes: MAX_CONVERSATION_BYTES,
    messages: MAX_CONVERSATION_MESSAGES,
};

struct ParsedSource {
    input: Option<HistoryConversationInput>,
    skipped_lines: i64,
}

fn record_warning(count: &mut HistorySourceCount, path: &Path, message: &str) {
    if count.warnings.len() < 20 {
        count
            .warnings
            .push(format!("{}: {message}", path.display()));
    }
}

/// Scan all supported local sources. No network call, API key, or LLM is used.
pub fn scan(db: &Db) -> AelResult<HistoryScanSummary> {
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

    scan_files(db, files)
}

fn scan_files(db: &Db, files: Vec<SourceFile>) -> AelResult<HistoryScanSummary> {
    let started_at = now_iso();
    let scan_id = Db::new_history_scan_id();
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
        let entry = source_counts
            .get_mut(source.kind.id())
            .expect("registered source kind");
        let parsed = match parse_json_source(&source.kind, &source.path, PARSE_LIMITS) {
            Ok(parsed) => parsed,
            Err(message) => {
                entry.skipped_files += 1;
                record_warning(entry, &source.path, &message);
                continue;
            }
        };
        entry.skipped_lines += parsed.skipped_lines;
        if parsed.skipped_lines > 0 {
            record_warning(
                entry,
                &source.path,
                &format!("跳过 {} 行无效或超过 4 MiB 的记录", parsed.skipped_lines),
            );
        }
        let Some(input) = parsed.input else {
            continue;
        };
        let message_count = input.messages.len() as i64;
        match db.replace_history_conversation(&input) {
            Ok(_) => {
                conversations += 1;
                messages += message_count;
                entry.sessions += 1;
                entry.messages += message_count;
            }
            Err(error) => {
                entry.skipped_files += 1;
                record_warning(
                    entry,
                    &source.path,
                    &format!("索引写入失败 ({})，保留旧索引", error.code),
                );
            }
        }
    }

    // OpenCode has used SQLite in different releases. We discover database
    // files separately and read only text-bearing rows from a read-only handle.
    for source in files.iter().filter(|source| is_sqlite_path(&source.path)) {
        let entry = source_counts
            .get_mut(SourceKind::OpenCode.id())
            .expect("registered source kind");
        let inputs = match parse_opencode_sqlite(&source.path) {
            Ok(inputs) => inputs,
            Err(message) => {
                entry.skipped_files += 1;
                record_warning(entry, &source.path, &message);
                continue;
            }
        };
        for input in inputs {
            let message_count = input.messages.len() as i64;
            if db.replace_history_conversation(&input).is_ok() {
                conversations += 1;
                messages += message_count;
                entry.sessions += 1;
                entry.messages += message_count;
            } else {
                entry.skipped_files += 1;
                record_warning(entry, &source.path, "SQLite 会话索引写入失败，保留旧索引");
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
    let mut pending = vec![root.to_path_buf()];
    let mut visited = BTreeSet::new();
    while let Some(directory) = pending.pop() {
        // Junctions/symlinks can form cycles on real developer machines.
        let Ok(canonical) = fs::canonicalize(&directory) else {
            continue;
        };
        if !visited.insert(canonical) {
            continue;
        }
        let Ok(entries) = fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                pending.push(path);
                continue;
            }
            let Some(ext) = path.extension().and_then(|v| v.to_str()) else {
                continue;
            };
            if extensions.contains(ext.to_ascii_lowercase().as_str()) {
                out.push(SourceFile { kind, path });
            }
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

/// Read one record without allowing a malicious/unbroken line to grow the buffer.
/// Hash even skipped bytes, so source_hash still represents the original file.
fn read_bounded_line<R: BufRead>(
    reader: &mut R,
    line: &mut Vec<u8>,
    limit: usize,
    hash: &mut Sha1,
) -> std::io::Result<Option<bool>> {
    line.clear();
    let mut total = 0usize;
    loop {
        let available = reader.fill_buf()?;
        if available.is_empty() {
            return Ok((total > 0).then_some(total > limit));
        }
        let take = available
            .iter()
            .position(|b| *b == b'\n')
            .map_or(available.len(), |i| i + 1);
        let finished = available[take - 1] == b'\n';
        hash.update(&available[..take]);
        let keep = take.min(limit.saturating_sub(line.len()));
        line.extend_from_slice(&available[..keep]);
        total = total.saturating_add(take);
        reader.consume(take);
        if finished {
            return Ok(Some(total > limit));
        }
    }
}

fn parse_json_source(
    kind: &SourceKind,
    path: &Path,
    limits: ParseLimits,
) -> Result<ParsedSource, String> {
    let file = fs::File::open(path).map_err(|_| "无法读取源文件，保留旧索引".to_string())?;
    if file.metadata().map_err(|_| "无法读取文件属性")?.len() > MAX_SOURCE_BYTES {
        return Err("源文件超过 512 MiB 上限，保留旧索引".into());
    }
    // A source may still be appended by its Agent while scanning. Bound the
    // actual read as well as the initial metadata check.
    let mut reader = BufReader::with_capacity(64 * 1024, file.take(MAX_SOURCE_BYTES + 1));
    let mut line = Vec::new();
    let mut hash = Sha1::new();
    let fallback = file_time(path);
    let mut messages = Vec::new();
    let mut session_id = None;
    let mut repo_path = None;
    let mut line_number = 0_i64;
    let mut skipped_lines = 0_i64;
    let mut retained_bytes = 0usize;
    while let Some(oversized) =
        read_bounded_line(&mut reader, &mut line, limits.line_bytes, &mut hash)
            .map_err(|_| "读取源文件失败，保留旧索引")?
    {
        line_number += 1;
        if oversized {
            skipped_lines += 1;
            continue;
        }
        if line.iter().all(u8::is_ascii_whitespace) {
            continue;
        }
        let value: Value = match serde_json::from_slice(&line) {
            Ok(value) => value,
            Err(_) => {
                skipped_lines += 1;
                continue;
            }
        };
        session_id = session_id.or_else(|| find_string(&value, SESSION_KEYS));
        repo_path = repo_path.or_else(|| find_path(&value));
        if let Some(message) = message_from_value(&value, line_number, &fallback) {
            retained_bytes = retained_bytes
                .saturating_add(message.text.len())
                .saturating_add(message.payload_json.as_ref().map_or(0, String::len));
            if retained_bytes > limits.conversation_bytes || messages.len() >= limits.messages {
                return Err(
                    "归一化会话超过内存/消息数上限（64 MiB / 100000 条），整份文件跳过并保留旧索引"
                        .into(),
                );
            }
            messages.push(message);
        }
    }
    if reader.get_ref().limit() == 0 {
        return Err("扫描期间源文件增长到超过 512 MiB，保留旧索引".into());
    }

    if messages.is_empty() {
        return Ok(ParsedSource {
            input: None,
            skipped_lines,
        });
    }
    let source_path = canonical_or_original(path);
    let source_session_id =
        session_id.unwrap_or_else(|| format!("file-{}", stable_hash(&source_path)));
    let source_hash = format!("{:x}", hash.finalize());
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

    Ok(ParsedSource {
        input: Some(HistoryConversationInput {
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
        }),
        skipped_lines,
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

fn parse_opencode_sqlite(path: &Path) -> Result<Vec<HistoryConversationInput>, String> {
    if path
        .metadata()
        .map_err(|_| "无法读取 SQLite 文件属性")?
        .len()
        > MAX_SOURCE_BYTES
    {
        return Err("SQLite 来源超过 512 MiB 上限，保留旧索引".into());
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "无法只读打开 SQLite 来源")?;
    let Ok(mut tables) = conn
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    else {
        return Err("无法读取 SQLite 来源表结构".into());
    };
    let table_names: Vec<String> = tables
        .query_map([], |row| row.get(0))
        .map_err(|_| "无法枚举 SQLite 来源表")?
        .collect::<Result<_, _>>()
        .map_err(|_| "SQLite 来源表结构无效")?;
    drop(tables);

    let mut result = Vec::new();
    let mut retained_bytes = 0usize;
    let mut message_count = 0usize;
    for table in table_names {
        let columns = table_columns(&conn, &table)?;
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
            "SELECT rowid, {}, {}, {}, {} FROM {}",
            bounded_column(text_col),
            optional_column(id_col.as_deref()),
            optional_column(time_col.as_deref()),
            optional_column(role_col.as_deref()),
            quote_ident(&table)
        );
        let mut rows = conn
            .prepare(&query)
            .map_err(|_| "无法读取 SQLite 来源消息表")?;
        let mut messages = Vec::new();
        let fallback = file_time(path);
        let mapped = rows.query_map([], |row| {
            let rowid: i64 = row.get(0)?;
            // SQL already rejects oversized fields; inspect byte length
            // before making any Rust String allocation (UTF-8 may be multibyte).
            for column in 1..=4 {
                if matches!(row.get_ref(column)?, rusqlite::types::ValueRef::Text(bytes) if bytes.len() > MAX_LINE_BYTES) {
                    return Err(rusqlite::Error::InvalidQuery);
                }
            }
            let text: Option<String> = row.get(1)?;
            let id: Option<String> = row.get(2)?;
            let created: Option<String> = row.get(3)?;
            let role: Option<String> = row.get(4)?;
            Ok((rowid, text, id, created, role))
        }).map_err(|_| "无法查询 SQLite 来源消息")?;
        {
            for row in mapped {
                let row =
                    row.map_err(|_| "SQLite 来源包含无法解析或超过 4 MiB 的消息，保留旧索引")?;
                let Some(text) = row.1.filter(|text| !text.trim().is_empty()) else {
                    continue;
                };
                retained_bytes = retained_bytes
                    .saturating_add(text.len())
                    .saturating_add(row.2.as_ref().map_or(0, String::len))
                    .saturating_add(row.3.as_ref().map_or(0, String::len))
                    .saturating_add(row.4.as_ref().map_or(0, String::len));
                message_count += 1;
                if retained_bytes > MAX_CONVERSATION_BYTES
                    || message_count > MAX_CONVERSATION_MESSAGES
                {
                    return Err("SQLite 来源超过内存/消息数上限，整份文件跳过并保留旧索引".into());
                }
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
    Ok(result)
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let query = format!("PRAGMA table_info({})", quote_ident(table));
    let mut stmt = conn.prepare(&query).map_err(|_| "无法读取 SQLite 表字段")?;
    let columns = stmt
        .query_map([], |row| row.get(1))
        .map_err(|_| "无法查询 SQLite 表字段")?
        .collect::<Result<_, _>>()
        .map_err(|_| "SQLite 表字段无效".to_string())?;
    Ok(columns)
}

fn optional_column(column: Option<&str>) -> String {
    column.map(bounded_column).unwrap_or_else(|| "NULL".into())
}

fn bounded_column(column: &str) -> String {
    // A zero-byte BLOB fails the expected TEXT decoding without returning the
    // oversized value to Rust. Byte length also catches embedded NUL text.
    let column = quote_ident(column);
    format!("CASE WHEN length(CAST({column} AS BLOB)) > {MAX_LINE_BYTES} THEN zeroblob(0) ELSE {column} END")
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
        .unwrap_or_else(fallback_time)
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
    use super::*;
    use rusqlite::Connection;
    use serde_json::json;
    use std::io::Write;
    use std::path::PathBuf;

    fn fixture_root() -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("ael-history-stability-{}", crate::util::new_id()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn history_stability_streams_large_jsonl_and_preserves_every_normal_record() {
        let root = fixture_root();
        let path = root.join("large.jsonl");
        let mut file = fs::File::create(&path).unwrap();
        let mut expected_hash = Sha1::new();
        for i in 0..20_000 {
            let record = format!(
                "{}\n",
                json!({"id":format!("message-{i}"),"role":"user","text":"a".repeat(480)})
            );
            file.write_all(record.as_bytes()).unwrap();
            expected_hash.update(record.as_bytes());
        }
        drop(file);
        assert!(path.metadata().unwrap().len() > 10_000_000);
        let parsed = parse_json_source(&SourceKind::Codex, &path, PARSE_LIMITS).unwrap();
        assert_eq!(parsed.skipped_lines, 0);
        let input = parsed.input.unwrap();
        assert_eq!(input.messages.len(), 20_000);
        assert_eq!(input.messages.last().unwrap().span_start, Some(20_000));
        assert_eq!(input.source_hash, format!("{:x}", expected_hash.finalize()));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn history_stability_skips_malformed_and_oversized_lines_then_resumes() {
        let root = fixture_root();
        let path = root.join("mixed.jsonl");
        let mut file = fs::File::create(&path).unwrap();
        writeln!(file, "{}", json!({"id":"first","text":"valid before"})).unwrap();
        writeln!(file, "not json").unwrap();
        file.write_all(&vec![b'x'; MAX_LINE_BYTES + 1024]).unwrap();
        file.write_all(b"\n").unwrap();
        writeln!(file, "{}", json!({"id":"last","text":"valid after"})).unwrap();
        drop(file);
        let parsed = parse_json_source(&SourceKind::Codex, &path, PARSE_LIMITS).unwrap();
        assert_eq!(parsed.skipped_lines, 2);
        let input = parsed.input.unwrap();
        assert_eq!(input.messages.len(), 2);
        assert_eq!(input.messages[1].span_start, Some(4));
        // The physical line buffer never retains the oversized tail.
        let mut reader = BufReader::new(std::io::Cursor::new(vec![b'x'; 100_000]));
        let mut line = Vec::new();
        assert_eq!(
            read_bounded_line(&mut reader, &mut line, 1024, &mut Sha1::new()).unwrap(),
            Some(true)
        );
        assert_eq!(line.len(), 1024);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn history_stability_reports_limits_and_preserves_previous_index() {
        let root = fixture_root();
        let path = root.join("source.jsonl");
        fs::write(
            &path,
            format!("{}\n", json!({"id":"original","text":"original evidence"})),
        )
        .unwrap();
        let state = crate::state::AppState::open_at(root.join("db")).unwrap();
        let first = scan_files(
            &state.db,
            vec![SourceFile {
                kind: SourceKind::Codex,
                path: path.clone(),
            }],
        )
        .unwrap();
        assert_eq!(first.conversations, 1);
        // A sparse oversize source is rejected using metadata, without reading 512 MiB.
        fs::OpenOptions::new()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(MAX_SOURCE_BYTES + 1)
            .unwrap();
        let second = scan_files(
            &state.db,
            vec![SourceFile {
                kind: SourceKind::Codex,
                path: path.clone(),
            }],
        )
        .unwrap();
        assert_eq!(second.source_counts["codex"].skipped_files, 1);
        assert!(second.source_counts["codex"].warnings[0].contains("512 MiB"));
        let conversations = state.db.list_history_conversations(100, 0).unwrap();
        assert_eq!(conversations.len(), 1);
        assert_eq!(
            state
                .db
                .list_history_messages(&conversations[0].id)
                .unwrap()[0]
                .text,
            "original evidence"
        );
        let persisted = state.db.latest_history_scan().unwrap().unwrap();
        assert_eq!(persisted.source_counts["codex"].skipped_files, 1);
        fs::write(&path, format!("{}\n", json!({"text":"x".repeat(2048)}))).unwrap();
        assert!(parse_json_source(
            &SourceKind::Codex,
            &path,
            ParseLimits {
                conversation_bytes: 1024,
                ..PARSE_LIMITS
            }
        )
        .is_err());
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn history_stability_rejects_oversized_sqlite_fields_before_copying() {
        let root = fixture_root();
        let path = root.join("oversized.sqlite");
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE messages(id TEXT,role TEXT,content TEXT);")
            .unwrap();
        conn.execute(
            "INSERT INTO messages VALUES ('m1','user',CAST(zeroblob(?1) AS TEXT))",
            [MAX_LINE_BYTES as i64 + 1],
        )
        .unwrap();
        drop(conn);
        let error = parse_opencode_sqlite(&path).unwrap_err();
        assert!(error.contains("4 MiB"));
        let state = crate::state::AppState::open_at(root.join("db")).unwrap();
        let summary = scan_files(
            &state.db,
            vec![SourceFile {
                kind: SourceKind::OpenCode,
                path,
            }],
        )
        .unwrap();
        assert_eq!(summary.source_counts["opencode"].skipped_files, 1);
        assert_eq!(summary.conversations, 0);
        drop(state);
        fs::remove_dir_all(root).unwrap();
    }

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

        let conversations = parse_opencode_sqlite(&PathBuf::from(&path)).expect("read fixture");
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
