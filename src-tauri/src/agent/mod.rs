//! 多 Agent 运行时 + 运行时海关接线。
//!
//! 设计目标:
//! - 用 PTY 而不是普通 stdout 管道,保留交互式 CLI 的 TTY 行为。
//! - 所有终端输入输出进入 transcript(落库前脱敏),并通过 Tauri event 实时推给前端。
//! - 输出按行复用 adapter 沉淀为 task_events,让 Failure Guard / Skill / handover 链路继续工作。
//! - v2:PTY 恰好坐在 Agent 与 Shell 之间 —— 逐行命令过「海关」策略引擎(事中裁决);
//!   输出流实时命中历史失败签名;会话 token 预算熔断。

pub mod compress;
pub mod config;
pub mod context;
pub mod usage;

use crate::adapter;
use crate::db::Db;
use crate::engine::policy::PolicyGate;
use crate::engine::{normalize, redact};
use crate::error::{AelError, AelResult};
use crate::models::{
    BudgetStatus, DecidedBy, NewPolicyDecision, PendingCommand, PolicyAction, PolicyDecision,
    PolicyVerdictKind, TaskEvent,
};
use crate::util::silent_command;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{
    mpsc::{sync_channel, SyncSender, TrySendError},
    Arc, Mutex,
};
use std::thread;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const TERMINAL_CHUNK_EVENT: &str = "agent://terminal-chunk";
const SESSION_STATUS_EVENT: &str = "agent://session-status";
const PARSED_EVENT_EVENT: &str = "agent://parsed-event";
// v2 治理事件
const GATE_PENDING_EVENT: &str = "gate://pending";
const GATE_DECISION_EVENT: &str = "gate://decision";
const GATE_BUDGET_EVENT: &str = "gate://budget";
const SIGNATURE_HIT_EVENT: &str = "guard://signature-hit";

const BUDGET_RULE_ID: &str = "budget";
const OUTPUT_QUEUE_CAPACITY: usize = 512;
pub const TERMINAL_PREVIEW_MAX_CHUNKS: usize = 1_000;
pub const TERMINAL_PREVIEW_MAX_BYTES: usize = 1_048_576;
const TERMINAL_TRUNCATION_MARKER: &str =
    "\r\n[AEL] 此输出块仅显示部分内容；完整记录保留在本机会话数据库。\r\n";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub kind: String,
    pub display_name: String,
    pub executable: String,
    pub default_args: Vec<String>,
    pub available: bool,
    pub version: Option<String>,
    pub path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentSessionStatus {
    Starting,
    Running,
    Waiting,
    Blocked,
    Exited,
    Killed,
    Failed,
}

impl AgentSessionStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Starting => "starting",
            Self::Running => "running",
            Self::Waiting => "waiting",
            Self::Blocked => "blocked",
            Self::Exited => "exited",
            Self::Killed => "killed",
            Self::Failed => "failed",
        }
    }

    pub fn from_db(s: &str) -> AelResult<Self> {
        match s {
            "starting" => Ok(Self::Starting),
            "running" => Ok(Self::Running),
            "waiting" => Ok(Self::Waiting),
            "blocked" => Ok(Self::Blocked),
            "exited" => Ok(Self::Exited),
            "killed" => Ok(Self::Killed),
            "failed" => Ok(Self::Failed),
            other => Err(AelError::internal(format!(
                "非法 AgentSessionStatus: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub id: String,
    pub task_id: String,
    pub profile_id: String,
    pub agent_id: String,
    pub status: AgentSessionStatus,
    pub cwd: String,
    pub command_line: String,
    pub started_at: String,
    pub updated_at: String,
    pub ended_at: Option<String>,
    pub exit_code: Option<i32>,
    pub last_seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalDirection {
    Input,
    Output,
    System,
}

impl TerminalDirection {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Input => "input",
            Self::Output => "output",
            Self::System => "system",
        }
    }

    pub fn from_db(s: &str) -> AelResult<Self> {
        match s {
            "input" => Ok(Self::Input),
            "output" => Ok(Self::Output),
            "system" => Ok(Self::System),
            other => Err(AelError::internal(format!(
                "非法 TerminalDirection: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceLockKind {
    Read,
    Write,
}

impl WorkspaceLockKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
        }
    }

    pub fn from_db(s: &str) -> AelResult<Self> {
        match s {
            "read" => Ok(Self::Read),
            "write" => Ok(Self::Write),
            other => Err(AelError::internal(format!(
                "非法 WorkspaceLockKind: {other}"
            ))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceLock {
    pub id: String,
    pub repo_path: String,
    pub owner_session_id: String,
    pub lock_kind: WorkspaceLockKind,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChunk {
    pub session_id: String,
    pub seq: u64,
    pub direction: TerminalDirection,
    pub text: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentOptions {
    pub task_id: String,
    pub profile_id: String,
    pub cwd: Option<String>,
    pub args: Option<Vec<String>>,
    pub initial_prompt: Option<String>,
    pub executable: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
    pub auto_ingest: Option<bool>,
    pub lock_workspace: Option<bool>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSnapshot {
    pub session: AgentSession,
    pub chunks: Vec<TerminalChunk>,
    pub truncated: bool,
    pub first_seq: Option<u64>,
    pub last_seq: Option<u64>,
}

/// Bound the rendered copy only. The original chunk is still persisted in full.
pub(crate) fn terminal_preview_text(
    text: &str,
    max_bytes: usize,
    from_end: bool,
    already_truncated: bool,
) -> (String, bool) {
    if !already_truncated && text.len() <= max_bytes {
        return (text.to_string(), false);
    }
    let available = max_bytes.saturating_sub(TERMINAL_TRUNCATION_MARKER.len());
    let body = if from_end {
        let mut start = text.len().saturating_sub(available);
        while start < text.len() && !text.is_char_boundary(start) {
            start += 1;
        }
        &text[start..]
    } else {
        let mut end = text.len().min(available);
        while !text.is_char_boundary(end) {
            end -= 1;
        }
        &text[..end]
    };
    if max_bytes < TERMINAL_TRUNCATION_MARKER.len() {
        return (String::new(), true);
    }
    if from_end {
        (format!("{TERMINAL_TRUNCATION_MARKER}{body}"), true)
    } else {
        (format!("{body}{TERMINAL_TRUNCATION_MARKER}"), true)
    }
}

#[derive(Default)]
struct TerminalHistoryBuffer {
    chunks: VecDeque<TerminalChunk>,
    bytes: usize,
}
impl TerminalHistoryBuffer {
    fn push(&mut self, chunk: &TerminalChunk) {
        let (text, _) = terminal_preview_text(&chunk.text, TERMINAL_PREVIEW_MAX_BYTES, true, false);
        let cached = TerminalChunk {
            session_id: chunk.session_id.clone(),
            seq: chunk.seq,
            direction: chunk.direction.clone(),
            text,
            created_at: chunk.created_at.clone(),
        };
        self.bytes += cached.text.len();
        self.chunks.push_back(cached);
        while self.chunks.len() > TERMINAL_PREVIEW_MAX_CHUNKS
            || self.bytes > TERMINAL_PREVIEW_MAX_BYTES
        {
            if let Some(oldest) = self.chunks.pop_front() {
                self.bytes -= oldest.text.len();
            }
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalChunkPayload {
    session_id: String,
    chunk: TerminalChunk,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatusPayload {
    session_id: String,
    session: AgentSession,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ParsedEventPayload {
    session_id: String,
    event: TaskEvent,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BudgetPayload {
    session_id: String,
    budget: BudgetStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SignatureHitPayload {
    session_id: String,
    signature: String,
    guard_rule: String,
    occurrences: i64,
    line: String,
}

/// 会话预算阶段(只在迁移时发事件,防事件风暴)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BudgetPhase {
    Normal,
    Warned,
    Tripped,
}

struct RuntimeSession {
    session: AgentSession,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    master: Box<dyn MasterPty + Send>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    output_tx: Option<SyncSender<String>>,
    dropped_output: u64,
    chunks: TerminalHistoryBuffer,
    pending_output: String,
    auto_ingest: bool,
    // v2 预算熔断计量
    input_chars: u64,
    output_chars: u64,
    budget_phase: BudgetPhase,
}

/// 扣在裁决线上待人工处置的命令(内存态)。
struct PendingHold {
    session_id: String,
    task_id: String,
    text: String, // 原始待写入 PTY 的整行(含换行)
    rule_id: String,
    reason: String,
    created_at: String,
}

#[derive(Default)]
pub struct AgentRuntime {
    sessions: Mutex<HashMap<String, RuntimeSession>>,
    pending: Mutex<HashMap<String, PendingHold>>,
    /// xterm 会逐键发送输入；这里保留尚未按回车提交的行，用于在提交时做完整策略判定。
    input_lines: Mutex<HashMap<String, String>>,
}

impl AgentRuntime {
    pub fn detect_profiles(&self) -> Vec<AgentProfile> {
        let mut profiles = Vec::new();
        for spec in builtin_specs() {
            profiles.push(profile_from_spec(spec));
        }
        profiles
    }

    pub fn detect_and_persist_profiles(&self, db: &Db) -> AelResult<Vec<AgentProfile>> {
        let profiles = self.detect_profiles();
        for profile in &profiles {
            db.upsert_agent_profile(profile)?;
        }
        Ok(profiles)
    }

    pub fn start_session(
        &self,
        app: AppHandle,
        db: &Db,
        opts: StartAgentOptions,
    ) -> AelResult<AgentSession> {
        let profile = self
            .detect_profiles()
            .into_iter()
            .find(|profile| profile.id == opts.profile_id)
            .ok_or_else(|| {
                AelError::invalid_input(format!("未知 Agent profile: {}", opts.profile_id))
            })?;

        let executable = opts
            .executable
            .clone()
            .or(profile.path.clone())
            .unwrap_or(profile.executable.clone());
        let path = resolve_executable(&executable)
            .ok_or_else(|| AelError::not_found(format!("未找到可执行文件: {executable}")))?;

        let cwd = opts
            .cwd
            .clone()
            .map(PathBuf::from)
            .unwrap_or(std::env::current_dir()?);
        if !cwd.exists() {
            return Err(AelError::not_found(format!(
                "工作目录不存在: {}",
                cwd.to_string_lossy()
            )));
        }
        let cwd = crate::util::canonical_working_dir(&cwd);

        let mut args = profile.default_args.clone();
        if let Some(extra) = opts.args.clone() {
            args.extend(extra);
        }

        let now = now_iso();
        let session_id = Uuid::new_v4().to_string();
        let command_line = render_command_line(&path, &args);
        let mut session = AgentSession {
            id: session_id.clone(),
            task_id: opts.task_id.clone(),
            profile_id: profile.id.clone(),
            agent_id: profile.kind.clone(),
            status: AgentSessionStatus::Starting,
            cwd: cwd.to_string_lossy().to_string(),
            command_line,
            started_at: now.clone(),
            updated_at: now,
            ended_at: None,
            exit_code: None,
            last_seq: 0,
        };
        db.insert_agent_session(&session)?;

        if opts.lock_workspace.unwrap_or(true) {
            if let Err(error) =
                db.acquire_workspace_lock(&session.cwd, &session.id, WorkspaceLockKind::Write)
            {
                mark_start_failed(db, &mut session)?;
                return Err(error);
            }
        }

        let pty_system = native_pty_system();
        let size = PtySize {
            rows: opts.rows.unwrap_or(30),
            cols: opts.cols.unwrap_or(100),
            pixel_width: 0,
            pixel_height: 0,
        };
        let pair = match pty_system.openpty(size) {
            Ok(pair) => pair,
            Err(e) => {
                let _ = db.release_workspace_locks_for_session(&session.id);
                mark_start_failed(db, &mut session)?;
                return Err(AelError::io_error(format!("打开 PTY 失败: {e}")));
            }
        };

        let mut command = CommandBuilder::new(path.to_string_lossy().to_string());
        command.args(&args);
        command.cwd(&cwd);

        let child = match pair.slave.spawn_command(command) {
            Ok(child) => child,
            Err(e) => {
                let _ = db.release_workspace_locks_for_session(&session.id);
                mark_start_failed(db, &mut session)?;
                return Err(AelError::io_error(format!("启动 Agent 失败: {e}")));
            }
        };
        drop(pair.slave);

        let mut reader = match pair.master.try_clone_reader() {
            Ok(reader) => reader,
            Err(e) => {
                let _ = db.release_workspace_locks_for_session(&session.id);
                mark_start_failed(db, &mut session)?;
                return Err(AelError::io_error(format!("创建 PTY reader 失败: {e}")));
            }
        };
        let writer = match pair.master.take_writer() {
            Ok(writer) => writer,
            Err(e) => {
                let _ = db.release_workspace_locks_for_session(&session.id);
                mark_start_failed(db, &mut session)?;
                return Err(AelError::io_error(format!("创建 PTY writer 失败: {e}")));
            }
        };

        let writer = Arc::new(Mutex::new(writer));
        let child = Arc::new(Mutex::new(child));
        let (output_tx, output_rx) = sync_channel::<String>(OUTPUT_QUEUE_CAPACITY);

        session.status = AgentSessionStatus::Running;
        session.updated_at = now_iso();
        db.update_agent_session(&session)?;

        {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            sessions.insert(
                session_id.clone(),
                RuntimeSession {
                    session: session.clone(),
                    writer: writer.clone(),
                    master: pair.master,
                    child: child.clone(),
                    output_tx: Some(output_tx),
                    dropped_output: 0,
                    chunks: TerminalHistoryBuffer::default(),
                    pending_output: String::new(),
                    auto_ingest: opts.auto_ingest.unwrap_or(true),
                    input_chars: 0,
                    output_chars: 0,
                    budget_phase: BudgetPhase::Normal,
                },
            );
        }

        let _ = app.emit(
            SESSION_STATUS_EVENT,
            SessionStatusPayload {
                session_id: session_id.clone(),
                session: session.clone(),
            },
        );

        self.push_system_chunk(db, &app, &session_id, "Agent session started.\r\n")?;

        // PTY reader 只负责快速读取并入队。数据库写入、解析和事件广播在
        // 独立 worker 中完成，避免高输出量时阻塞 PTY 和 Tauri 命令线程。
        let worker_app = app.clone();
        let worker_session_id = session_id.clone();
        thread::spawn(move || {
            while let Ok(text) = output_rx.recv() {
                let Some(state) = worker_app.try_state::<crate::state::AppState>() else {
                    break;
                };
                let dropped = state.agents.take_dropped_output(&worker_session_id);
                if dropped > 0 {
                    let _ = state.agents.push_system_chunk(
                        &state.db,
                        &worker_app,
                        &worker_session_id,
                        &format!(
                            "[AEL] 输出过载，已丢弃 {dropped} 个终端块；请降低日志级别或扩大采样间隔。\r\n"
                        ),
                    );
                }
                let lines = state.agents.push_output_chunk(
                    &state.db,
                    &worker_app,
                    &worker_session_id,
                    text,
                );
                if !lines.trim().is_empty() {
                    state
                        .agents
                        .ingest_completed_lines(&worker_app, &worker_session_id, &lines);
                }
            }
        });

        let read_app = app.clone();
        let read_session_id = session_id.clone();
        thread::spawn(move || {
            let mut buffer = [0_u8; 8192];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(n) => {
                        let text = String::from_utf8_lossy(&buffer[..n]).to_string();
                        if let Some(state) = read_app.try_state::<crate::state::AppState>() {
                            state.agents.enqueue_output_chunk(&read_session_id, text);
                        } else {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }

            if let Some(state) = read_app.try_state::<crate::state::AppState>() {
                state
                    .agents
                    .finish_reader_session(&state.db, &read_app, &read_session_id);
            }
        });

        // 启动上下文注入走 raw 通道,不经海关(否则可能被 prompt 里的示例命令误扣)。
        // 它是给模型读的 Markdown;交给 Shell 会被逐行当命令执行,所以 Shell 不注入。
        if let Some(prompt) = opts.initial_prompt.filter(|_| profile.kind != "shell") {
            if !prompt.trim().is_empty() {
                self.send_input_raw(db, &app, &session_id, format!("{prompt}\r\n"))?;
            }
        }

        Ok(session)
    }

    /// 公共输入通道:经海关裁决。含换行的整行才被视作「命令提交」并送策略引擎。
    pub fn send_input(
        &self,
        db: &Db,
        app: &AppHandle,
        gate: &PolicyGate,
        session_id: &str,
        text: String,
    ) -> AelResult<()> {
        if !gate.apply_to_input() {
            if text.contains('\r') || text.contains('\n') {
                self.input_lines
                    .lock()
                    .expect("input line mutex poisoned")
                    .remove(session_id);
            }
            return self.send_input_raw(db, app, session_id, text);
        }

        let (command_line, is_submit, had_buffered_prefix) =
            self.track_input_line(session_id, &text)?;
        if !is_submit {
            // xterm 的单个字符 / 控制键仍需即时透传；回车提交时再对整行裁决。
            return self.send_input_raw(db, app, session_id, text);
        }

        let task_id = self.session_task_id(session_id)?;
        let command_line = command_line.trim().to_string();
        if command_line.is_empty() {
            return self.send_input_raw(db, app, session_id, text);
        }

        // 逐键输入时，命令前缀已经进入交互 Shell 的编辑缓冲区；在 hold/deny
        // 前先发 Ctrl-C 清掉它，避免人工裁决前被回车意外执行或审批后重复拼接。
        let cancel_buffer = |this: &Self| {
            if had_buffered_prefix {
                let _ = this.send_input_raw(db, app, session_id, "\u{3}".to_string());
            }
        };

        // 预算熔断优先。
        let (budget_enabled, _, _) = gate.budget_params();
        let tripped = budget_enabled && self.budget_tripped(session_id);

        let verdict = if tripped {
            crate::models::PolicyVerdict {
                rule_id: Some(BUDGET_RULE_ID.to_string()),
                action: PolicyAction::Hold,
                reason: "会话 token 预算已熔断,新命令需人工确认".to_string(),
                matched: true,
            }
        } else {
            gate.evaluate(&command_line)
        };

        match verdict.action {
            PolicyAction::Allow => self.send_input_raw(db, app, session_id, text),
            PolicyAction::Warn => {
                self.send_input_raw(db, app, session_id, text)?;
                let rule = verdict.rule_id.clone().unwrap_or_default();
                self.record_decision(
                    db,
                    app,
                    Some(session_id),
                    Some(&task_id),
                    &rule,
                    PolicyAction::Warn,
                    PolicyVerdictKind::Warned,
                    &command_line,
                    &verdict.reason,
                    DecidedBy::Policy,
                    true,
                )?;
                let _ = self.push_system_chunk(
                    db,
                    app,
                    session_id,
                    &format!(
                        "[AEL·海关] 警告(规则 {rule}):{} · 已放行并留痕\r\n",
                        verdict.reason
                    ),
                );
                Ok(())
            }
            PolicyAction::Hold => {
                cancel_buffer(self);
                let rule = verdict.rule_id.clone().unwrap_or_default();
                let pending = self.enqueue_hold(
                    session_id,
                    &task_id,
                    &format!("{command_line}\r\n"),
                    &rule,
                    &verdict.reason,
                    gate.hold_timeout_secs(),
                );
                let _ = self.push_system_chunk(
                    db,
                    app,
                    session_id,
                    &format!(
                        "[AEL·海关] 命令已扣留待裁决(规则 {rule}):{} — 请在裁决线上放行或拦截\r\n",
                        verdict.reason
                    ),
                );
                let _ = app.emit(GATE_PENDING_EVENT, &pending);
                self.spawn_hold_timeout(app.clone(), pending.id.clone(), gate.hold_timeout_secs());
                Ok(())
            }
            PolicyAction::Deny => {
                cancel_buffer(self);
                let rule = verdict.rule_id.clone().unwrap_or_default();
                self.record_decision(
                    db,
                    app,
                    Some(session_id),
                    Some(&task_id),
                    &rule,
                    PolicyAction::Deny,
                    PolicyVerdictKind::AutoDenied,
                    &command_line,
                    &verdict.reason,
                    DecidedBy::Policy,
                    true,
                )?;
                let _ = self.push_system_chunk(
                    db,
                    app,
                    session_id,
                    &format!("[AEL·海关] 命令已拦截(规则 {rule}):{}\r\n", verdict.reason),
                );
                Ok(())
            }
        }
    }

    /// 原始输入:直接写 PTY + 记 input chunk。不经海关(内部注入 / 人工放行后写入用)。
    pub fn send_input_raw(
        &self,
        db: &Db,
        app: &AppHandle,
        session_id: &str,
        text: String,
    ) -> AelResult<()> {
        let writer = {
            let sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            sessions
                .get(session_id)
                .map(|session| session.writer.clone())
                .ok_or_else(|| AelError::not_found(format!("session {session_id} 不存在")))?
        };

        // PTY 写入可能阻塞，但不再占用 sessions 总锁，其他会话仍可查询、停止和调整尺寸。
        {
            let mut writer = writer.lock().expect("agent writer mutex poisoned");
            writer.write_all(text.as_bytes())?;
            writer.flush()?;
        }

        let chunk = {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            let session = sessions
                .get_mut(session_id)
                .ok_or_else(|| AelError::not_found(format!("session {session_id} 不存在")))?;
            session.input_chars += text.chars().count() as u64;
            make_chunk(session, TerminalDirection::Input, text)
        };
        self.persist_chunk(db, app, &chunk);
        emit_chunk(app, session_id, chunk);
        Ok(())
    }

    pub fn resize_session(&self, session_id: &str, cols: u16, rows: u16) -> AelResult<()> {
        let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| AelError::not_found(format!("session {session_id} 不存在")))?;
        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| AelError::io_error(format!("调整 PTY 尺寸失败: {e}")))?;
        Ok(())
    }

    pub fn stop_session(
        &self,
        db: &Db,
        app: &AppHandle,
        session_id: &str,
        kill_tree: bool,
    ) -> AelResult<AgentSession> {
        let child = {
            let sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            sessions
                .get(session_id)
                .map(|session| session.child.clone())
                .ok_or_else(|| AelError::not_found(format!("session {session_id} 不存在")))?
        };
        if kill_tree {
            child
                .lock()
                .expect("agent child mutex poisoned")
                .kill()
                .map_err(|e| AelError::io_error(format!("停止 Agent 失败: {e}")))?;
        }
        self.mark_session_status(db, app, session_id, AgentSessionStatus::Killed, None)
    }

    pub fn list_sessions(
        &self,
        db: &Db,
        task_id: Option<String>,
        status: Option<String>,
    ) -> AelResult<Vec<AgentSession>> {
        db.list_agent_sessions(task_id, status)
    }

    pub fn snapshot(&self, db: &Db, session_id: &str) -> AelResult<AgentSnapshot> {
        let session = db.get_agent_session(session_id)?;
        let (chunks, truncated) = db.terminal_chunk_page(session_id, None, true)?;
        let first_seq = chunks.first().map(|chunk| chunk.seq);
        let last_seq = chunks.last().map(|chunk| chunk.seq);
        Ok(AgentSnapshot {
            session,
            chunks,
            truncated,
            first_seq,
            last_seq,
        })
    }

    pub fn list_chunks(
        &self,
        db: &Db,
        session_id: &str,
        after_seq: Option<u64>,
    ) -> AelResult<Vec<TerminalChunk>> {
        db.terminal_chunk_page(session_id, after_seq, false)
            .map(|(chunks, _)| chunks)
    }

    // ── 海关:扣留队列 / 人工裁决 ────────────────────────────────

    /// 列出当前所有待裁决命令。
    pub fn list_pending(&self) -> Vec<PendingCommand> {
        let pending = self.pending.lock().expect("pending mutex poisoned");
        pending
            .iter()
            .map(|(id, h)| PendingCommand {
                id: id.clone(),
                session_id: h.session_id.clone(),
                task_id: h.task_id.clone(),
                command_text: h.text.trim().to_string(),
                rule_id: h.rule_id.clone(),
                reason: h.reason.clone(),
                created_at: h.created_at.clone(),
                timeout_secs: 0,
                permission_options: Vec::new(),
            })
            .collect()
    }

    /// 人工在裁决线上放行 / 拦截。
    pub fn resolve_pending(
        &self,
        db: &Db,
        app: &AppHandle,
        pending_id: &str,
        approve: bool,
    ) -> AelResult<PolicyDecision> {
        let hold = {
            let mut pending = self.pending.lock().expect("pending mutex poisoned");
            pending.remove(pending_id)
        }
        .ok_or_else(|| AelError::not_found(format!("待裁决命令 {pending_id} 不存在或已处理")))?;

        let command_line = hold.text.trim().to_string();
        if approve {
            if let Err(error) = self.send_input_raw(db, app, &hold.session_id, hold.text.clone()) {
                // 会话可能在人工点击前已退出；仍把这次裁决写入账本，避免出现“待处理
                // 消失但没有结局”的悬空记录。
                let _ = self.record_decision(
                    db,
                    app,
                    Some(&hold.session_id),
                    Some(&hold.task_id),
                    &hold.rule_id,
                    PolicyAction::Hold,
                    PolicyVerdictKind::AutoDenied,
                    &command_line,
                    &format!("会话已结束，无法放行: {}", error),
                    DecidedBy::Policy,
                    true,
                );
                return Err(error);
            }
            let d = self.record_decision(
                db,
                app,
                Some(&hold.session_id),
                Some(&hold.task_id),
                &hold.rule_id,
                PolicyAction::Hold,
                PolicyVerdictKind::Approved,
                &command_line,
                &hold.reason,
                DecidedBy::Human,
                true,
            )?;
            let _ = self.push_system_chunk(
                db,
                app,
                &hold.session_id,
                "[AEL·海关] 人工放行 · 已留痕\r\n",
            );
            Ok(d)
        } else {
            let d = self.record_decision(
                db,
                app,
                Some(&hold.session_id),
                Some(&hold.task_id),
                &hold.rule_id,
                PolicyAction::Hold,
                PolicyVerdictKind::Denied,
                &command_line,
                &hold.reason,
                DecidedBy::Human,
                true,
            )?;
            let _ = self.push_system_chunk(
                db,
                app,
                &hold.session_id,
                "[AEL·海关] 人工拦截 · 命令未进入 Shell,签名入库\r\n",
            );
            Ok(d)
        }
    }

    /// 会话当前预算状态(供 UI 主动查询)。
    pub fn budget_status(
        &self,
        db: &Db,
        gate: &PolicyGate,
        session_id: &str,
    ) -> AelResult<BudgetStatus> {
        let (enabled, max_tokens, _) = gate.budget_params();
        let used = self.session_used_tokens(db, session_id);
        let ratio = if max_tokens > 0 {
            used as f64 / max_tokens as f64
        } else {
            0.0
        };
        Ok(BudgetStatus {
            enabled,
            max_session_tokens: max_tokens,
            used_tokens: used,
            ratio,
            breaker_tripped: enabled && used >= max_tokens,
        })
    }

    // ── 内部:输出处理 ──────────────────────────────────────────

    fn track_input_line(&self, session_id: &str, text: &str) -> AelResult<(String, bool, bool)> {
        {
            let sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            if !sessions.contains_key(session_id) {
                return Err(AelError::not_found(format!("session {session_id} 不存在")));
            }
        }

        let mut lines = self.input_lines.lock().expect("input line mutex poisoned");
        let line = lines.entry(session_id.to_string()).or_default();
        let had_prefix = !line.is_empty();
        if text.contains('\r') || text.contains('\n') {
            // 粘贴多行时整段作为一次候选命令评估，不能只检查第一行后把
            // 后续危险行一并透传。
            let command = format!("{line}{text}");
            line.clear();
            return Ok((command, true, had_prefix));
        }
        let mut escaped = false;
        let mut submitted = false;
        for ch in text.chars() {
            if submitted {
                // 粘贴多行时，后续内容会由下一次输入重新建立缓冲，避免把多条命令
                // 合并成一条裁决记录。
                continue;
            }
            match ch {
                '\u{1b}' => {
                    // 方向键 / TUI 控制序列无法可靠还原编辑结果，清空本地镜像，
                    // 仍透传原始按键；需要严格裁决的完整命令请用下方输入框。
                    escaped = true;
                    line.clear();
                }
                '\r' | '\n' => {
                    submitted = true;
                }
                '\u{3}' => {
                    line.clear();
                    escaped = false;
                }
                '\u{8}' | '\u{7f}' => {
                    if !escaped {
                        line.pop();
                    }
                }
                c if !escaped && !c.is_control() => line.push(c),
                _ => {}
            }
        }

        if submitted {
            let command = std::mem::take(line);
            Ok((command, true, had_prefix))
        } else {
            Ok((String::new(), false, had_prefix))
        }
    }

    /// 非阻塞地把 PTY 输出放入有界队列。队列满时丢弃当前块并累计计数，
    /// 由 worker 在恢复消费后写入一条可见告警，避免 reader 被慢速磁盘拖死。
    fn enqueue_output_chunk(&self, session_id: &str, text: String) {
        let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
        let Some(session) = sessions.get_mut(session_id) else {
            return;
        };
        let Some(sender) = session.output_tx.as_ref() else {
            return;
        };
        match sender.try_send(text) {
            Ok(()) => {}
            Err(TrySendError::Full(_)) => {
                session.dropped_output = session.dropped_output.saturating_add(1);
            }
            Err(TrySendError::Disconnected(_)) => {
                session.output_tx = None;
            }
        }
    }

    fn take_dropped_output(&self, session_id: &str) -> u64 {
        let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
        sessions
            .get_mut(session_id)
            .map(|session| std::mem::take(&mut session.dropped_output))
            .unwrap_or(0)
    }

    /// reader EOF 后等待真实子进程状态；若会话已被 stop 标记为 killed，则不覆盖该终态。
    fn finish_reader_session(&self, db: &Db, app: &AppHandle, session_id: &str) {
        let child = {
            let sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            let Some(session) = sessions.get(session_id) else {
                return;
            };
            if !matches!(
                session.session.status,
                AgentSessionStatus::Starting
                    | AgentSessionStatus::Running
                    | AgentSessionStatus::Waiting
                    | AgentSessionStatus::Blocked
            ) {
                return;
            }
            session.child.clone()
        };

        let exit_code = child
            .lock()
            .ok()
            .and_then(|mut child| child.wait().ok())
            .map(|status| status.exit_code() as i32);
        let _ =
            self.mark_session_status(db, app, session_id, AgentSessionStatus::Exited, exit_code);
    }

    fn push_output_chunk(
        &self,
        db: &Db,
        app: &AppHandle,
        session_id: &str,
        text: String,
    ) -> String {
        let (chunk, completed_lines) = {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            let Some(session) = sessions.get_mut(session_id) else {
                return String::new();
            };
            session.output_chars += text.chars().count() as u64;
            let chunk = make_chunk(session, TerminalDirection::Output, text.clone());
            let clean = strip_ansi(&text);
            session.pending_output.push_str(&clean);
            let completed = take_completed_lines(&mut session.pending_output);
            (chunk, completed)
        };
        self.persist_chunk(db, app, &chunk);
        emit_chunk(app, session_id, chunk);
        self.check_budget(app, session_id);
        completed_lines
    }

    fn push_system_chunk(
        &self,
        db: &Db,
        app: &AppHandle,
        session_id: &str,
        text: &str,
    ) -> AelResult<()> {
        let chunk = {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            let session = sessions
                .get_mut(session_id)
                .ok_or_else(|| AelError::not_found(format!("session {session_id} 不存在")))?;
            make_chunk(session, TerminalDirection::System, text.to_string())
        };
        self.persist_chunk(db, app, &chunk);
        emit_chunk(app, session_id, chunk);
        Ok(())
    }

    /// 落库前脱敏(前端 emit 的仍是原文)。
    fn persist_chunk(&self, db: &Db, app: &AppHandle, chunk: &TerminalChunk) {
        let redact_on = app
            .try_state::<crate::state::AppState>()
            .map(|s| s.gate.redaction_enabled())
            .unwrap_or(true);
        let to_store = if redact_on {
            TerminalChunk {
                text: redact::redact(&chunk.text),
                ..chunk.clone()
            }
        } else {
            chunk.clone()
        };
        if let Err(error) = db.append_terminal_chunk(&to_store) {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            if let Some(session) = sessions.get_mut(chunk.session_id.as_str()) {
                let warn = make_chunk(
                    session,
                    TerminalDirection::System,
                    format!("AEL transcript persist failed: {error}\r\n"),
                );
                drop(sessions);
                let _ = db.append_terminal_chunk(&warn);
                emit_chunk(app, &chunk.session_id, warn);
            }
        }
    }

    fn ingest_completed_lines(&self, app: &AppHandle, session_id: &str, lines: &str) {
        let (task_id, agent_id, auto_ingest) = {
            let sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            let Some(session) = sessions.get(session_id) else {
                return;
            };
            (
                session.session.task_id.clone(),
                session.session.agent_id.clone(),
                session.auto_ingest,
            )
        };
        if !auto_ingest {
            return;
        }

        let state = app.state::<crate::state::AppState>();
        match adapter::ingest(&state.db, &task_id, &agent_id, Some(session_id), lines) {
            Ok(events) => {
                for event in &events {
                    let _ = app.emit(
                        PARSED_EVENT_EVENT,
                        ParsedEventPayload {
                            session_id: session_id.to_string(),
                            event: event.clone(),
                        },
                    );
                }
                // 事中签名命中:对新入库的 error 事件查失败库。
                self.scan_signature_hits(&state.db, app, session_id, &events);
            }
            Err(error) => {
                let _ = self.push_system_chunk(
                    &state.db,
                    app,
                    session_id,
                    &format!("AEL ingest skipped: {error}\r\n"),
                );
            }
        }
    }

    /// 输出流上的历史失败签名命中 → 事中预警(不打断 Agent,只提示 + 留痕)。
    fn scan_signature_hits(
        &self,
        db: &Db,
        app: &AppHandle,
        session_id: &str,
        events: &[TaskEvent],
    ) {
        for ev in events {
            if ev.kind != crate::models::EventKind::Error {
                continue;
            }
            let text = match &ev.detail {
                Some(d) if !d.trim().is_empty() => format!("{}\n{}", ev.summary, d),
                _ => ev.summary.clone(),
            };
            let (_, signature) = normalize::normalize_and_sign(&text);
            if let Ok(Some(failure)) = db.find_failure_by_signature(&signature) {
                let _ = app.emit(
                    SIGNATURE_HIT_EVENT,
                    SignatureHitPayload {
                        session_id: session_id.to_string(),
                        signature: signature.clone(),
                        guard_rule: failure.guard_rule.clone(),
                        occurrences: failure.occurrences,
                        line: ev.summary.clone(),
                    },
                );
                let _ = self.push_system_chunk(
                    db,
                    app,
                    session_id,
                    &format!(
                        "[AEL·护栏] 签名命中失败库(历史 {} 次):{}\r\n",
                        failure.occurrences, failure.guard_rule
                    ),
                );
            }
        }
    }

    // ── 预算熔断 ────────────────────────────────────────────────

    fn check_budget(&self, app: &AppHandle, session_id: &str) {
        let Some(state) = app.try_state::<crate::state::AppState>() else {
            return;
        };
        let (enabled, max_tokens, warn_ratio) = state.gate.budget_params();
        if !enabled || max_tokens == 0 {
            return;
        }
        let (used, new_phase, changed) = {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            let Some(session) = sessions.get_mut(session_id) else {
                return;
            };
            let used = (session.input_chars + session.output_chars) / 4;
            let ratio = used as f64 / max_tokens as f64;
            let phase = if ratio >= 1.0 {
                BudgetPhase::Tripped
            } else if ratio >= warn_ratio {
                BudgetPhase::Warned
            } else {
                BudgetPhase::Normal
            };
            let changed = phase != session.budget_phase;
            session.budget_phase = phase;
            (used, phase, changed)
        };
        if !changed {
            return;
        }
        let _ = app.emit(
            GATE_BUDGET_EVENT,
            BudgetPayload {
                session_id: session_id.to_string(),
                budget: BudgetStatus {
                    enabled,
                    max_session_tokens: max_tokens,
                    used_tokens: used,
                    ratio: used as f64 / max_tokens as f64,
                    breaker_tripped: new_phase == BudgetPhase::Tripped,
                },
            },
        );
        if new_phase == BudgetPhase::Tripped {
            let _ = self.push_system_chunk(
                &state.db,
                app,
                session_id,
                "[AEL·海关] 会话 token 预算已熔断 —— 后续命令需人工确认放行\r\n",
            );
        }
    }

    fn budget_tripped(&self, session_id: &str) -> bool {
        let sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
        sessions
            .get(session_id)
            .map(|s| s.budget_phase == BudgetPhase::Tripped)
            .unwrap_or(false)
    }

    fn session_used_tokens(&self, db: &Db, session_id: &str) -> u64 {
        {
            let sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            if let Some(s) = sessions.get(session_id) {
                return (s.input_chars + s.output_chars) / 4;
            }
        }
        // 会话已退出:退回按 transcript 估算。
        usage::session_token_usage(db, session_id)
            .map(|u| u.total_tokens)
            .unwrap_or(0)
    }

    // ── 海关账本 ────────────────────────────────────────────────

    #[allow(clippy::too_many_arguments)]
    fn record_decision(
        &self,
        db: &Db,
        app: &AppHandle,
        session_id: Option<&str>,
        task_id: Option<&str>,
        rule_id: &str,
        action: PolicyAction,
        verdict: PolicyVerdictKind,
        command_text: &str,
        reason: &str,
        decided_by: DecidedBy,
        resolved: bool,
    ) -> AelResult<PolicyDecision> {
        let decision = db.insert_policy_decision(NewPolicyDecision {
            session_id: session_id.map(|s| s.to_string()),
            task_id: task_id.map(|s| s.to_string()),
            rule_id: rule_id.to_string(),
            action,
            verdict,
            command_text: command_text.to_string(),
            reason: reason.to_string(),
            decided_by,
            resolved_at: if resolved { Some(now_iso()) } else { None },
        })?;
        let _ = app.emit(GATE_DECISION_EVENT, &decision);
        Ok(decision)
    }

    fn enqueue_hold(
        &self,
        session_id: &str,
        task_id: &str,
        text: &str,
        rule_id: &str,
        reason: &str,
        timeout_secs: u64,
    ) -> PendingCommand {
        let id = Uuid::new_v4().to_string();
        let created_at = now_iso();
        let mut pending = self.pending.lock().expect("pending mutex poisoned");
        pending.insert(
            id.clone(),
            PendingHold {
                session_id: session_id.to_string(),
                task_id: task_id.to_string(),
                text: text.to_string(),
                rule_id: rule_id.to_string(),
                reason: reason.to_string(),
                created_at: created_at.clone(),
            },
        );
        PendingCommand {
            id,
            session_id: session_id.to_string(),
            task_id: task_id.to_string(),
            command_text: text.trim().to_string(),
            rule_id: rule_id.to_string(),
            reason: reason.to_string(),
            created_at,
            timeout_secs,
            permission_options: Vec::new(),
        }
    }

    /// 超时未裁决 → 默认拦截(auto_denied)。
    fn spawn_hold_timeout(&self, app: AppHandle, pending_id: String, timeout_secs: u64) {
        if timeout_secs == 0 {
            return; // 0 = 永不超时
        }
        thread::spawn(move || {
            thread::sleep(std::time::Duration::from_secs(timeout_secs));
            let Some(state) = app.try_state::<crate::state::AppState>() else {
                return;
            };
            let hold = {
                let mut pending = state.agents.pending.lock().expect("pending mutex poisoned");
                pending.remove(&pending_id)
            };
            if let Some(hold) = hold {
                let command_line = hold.text.trim().to_string();
                let _ = state.agents.record_decision(
                    &state.db,
                    &app,
                    Some(&hold.session_id),
                    Some(&hold.task_id),
                    &hold.rule_id,
                    PolicyAction::Hold,
                    PolicyVerdictKind::AutoDenied,
                    &command_line,
                    &hold.reason,
                    DecidedBy::Policy,
                    true,
                );
                let _ = state.agents.push_system_chunk(
                    &state.db,
                    &app,
                    &hold.session_id,
                    "[AEL·海关] 扣留超时,默认拦截\r\n",
                );
            }
        });
    }

    fn session_task_id(&self, session_id: &str) -> AelResult<String> {
        let sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
        sessions
            .get(session_id)
            .map(|s| s.session.task_id.clone())
            .ok_or_else(|| AelError::not_found(format!("session {session_id} 不存在")))
    }

    fn mark_session_status(
        &self,
        db: &Db,
        app: &AppHandle,
        session_id: &str,
        status: AgentSessionStatus,
        exit_code: Option<i32>,
    ) -> AelResult<AgentSession> {
        let snapshot = {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            let session = sessions
                .get_mut(session_id)
                .ok_or_else(|| AelError::not_found(format!("session {session_id} 不存在")))?;
            session.session.status = status;
            session.session.updated_at = now_iso();
            if matches!(
                session.session.status,
                AgentSessionStatus::Exited
                    | AgentSessionStatus::Killed
                    | AgentSessionStatus::Failed
            ) {
                // 关闭 worker 的发送端；worker 会先消费队列中剩余输出，再自然退出。
                session.output_tx.take();
                session.session.ended_at = Some(session.session.updated_at.clone());
                session.session.exit_code = exit_code;
            }
            session.session.clone()
        };
        db.update_agent_session(&snapshot)?;
        if matches!(
            snapshot.status,
            AgentSessionStatus::Exited | AgentSessionStatus::Killed | AgentSessionStatus::Failed
        ) {
            self.input_lines
                .lock()
                .expect("input line mutex poisoned")
                .remove(session_id);
            let _ = db.release_workspace_locks_for_session(session_id);
        }

        let _ = app.emit(
            SESSION_STATUS_EVENT,
            SessionStatusPayload {
                session_id: session_id.to_string(),
                session: snapshot.clone(),
            },
        );
        Ok(snapshot)
    }
}

#[derive(Clone, Copy)]
struct AgentSpec {
    id: &'static str,
    kind: &'static str,
    display_name: &'static str,
    executable: &'static str,
    default_args: &'static [&'static str],
    version_args: &'static [&'static str],
}

fn builtin_specs() -> Vec<AgentSpec> {
    let mut specs = vec![
        AgentSpec {
            id: "codex",
            kind: "codex",
            display_name: "Codex CLI",
            executable: "codex",
            default_args: &[],
            version_args: &["--version"],
        },
        AgentSpec {
            id: "claude_code",
            kind: "claude_code",
            display_name: "Claude Code",
            executable: "claude",
            default_args: &[],
            version_args: &["--version"],
        },
        AgentSpec {
            id: "gemini",
            kind: "gemini",
            display_name: "Gemini CLI",
            executable: "gemini",
            default_args: &[],
            version_args: &["--version"],
        },
        AgentSpec {
            id: "opencode",
            kind: "opencode",
            display_name: "OpenCode",
            executable: "opencode",
            default_args: &[],
            version_args: &["--version"],
        },
    ];

    #[cfg(windows)]
    specs.push(AgentSpec {
        id: "shell",
        kind: "shell",
        display_name: "PowerShell",
        executable: "powershell.exe",
        default_args: &["-NoLogo"],
        version_args: &[
            "-NoLogo",
            "-Command",
            "$PSVersionTable.PSVersion.ToString()",
        ],
    });

    #[cfg(not(windows))]
    specs.push(AgentSpec {
        id: "shell",
        kind: "shell",
        display_name: "Shell",
        executable: "sh",
        default_args: &[],
        version_args: &["--version"],
    });

    specs
}

fn profile_from_spec(spec: AgentSpec) -> AgentProfile {
    let path = resolve_executable(spec.executable);
    let version = path
        .as_ref()
        .and_then(|path| read_version(path, spec.version_args));
    AgentProfile {
        id: spec.id.to_string(),
        kind: spec.kind.to_string(),
        display_name: spec.display_name.to_string(),
        executable: spec.executable.to_string(),
        default_args: spec
            .default_args
            .iter()
            .map(|arg| arg.to_string())
            .collect(),
        available: path.is_some(),
        version,
        path: path.map(|p| p.to_string_lossy().to_string()),
    }
}

pub(crate) fn resolve_executable(name: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(name);
    if candidate.is_absolute() && candidate.exists() {
        return Some(candidate);
    }

    #[cfg(windows)]
    let output = silent_command("where.exe").arg(name).output().ok()?;
    #[cfg(not(windows))]
    let output = silent_command("which").arg(name).output().ok()?;

    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    pick_runnable(stdout.lines()).map(PathBuf::from)
}

/// npm 会同时生成无扩展名的 shell 脚本和 .cmd。Windows 上前者无法直接启动，
/// 而 where.exe 常把它排在第一位，所以优先选可执行扩展名。
fn pick_runnable<'a>(lines: impl Iterator<Item = &'a str>) -> Option<&'a str> {
    let candidates: Vec<&str> = lines
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    if cfg!(windows) {
        let runnable = candidates.iter().find(|line| {
            let lower = line.to_ascii_lowercase();
            [".exe", ".cmd", ".bat", ".com"]
                .iter()
                .any(|ext| lower.ends_with(ext))
        });
        if let Some(line) = runnable {
            return Some(line);
        }
    }
    candidates.first().copied()
}

fn read_version(executable: &Path, args: &[&str]) -> Option<String> {
    let output = silent_command(executable).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if !stdout.is_empty() {
        Some(stdout.lines().next().unwrap_or("").to_string())
    } else if !stderr.is_empty() {
        Some(stderr.lines().next().unwrap_or("").to_string())
    } else {
        None
    }
}

fn render_command_line(executable: &Path, args: &[String]) -> String {
    let mut parts = vec![executable.to_string_lossy().to_string()];
    parts.extend(args.iter().cloned());
    parts.join(" ")
}

fn make_chunk(
    session: &mut RuntimeSession,
    direction: TerminalDirection,
    text: String,
) -> TerminalChunk {
    let chunk = next_terminal_chunk(&mut session.session, direction, text);
    session.chunks.push(&chunk);
    chunk
}

fn next_terminal_chunk(
    session: &mut AgentSession,
    direction: TerminalDirection,
    text: String,
) -> TerminalChunk {
    session.last_seq += 1;
    session.updated_at = now_iso();
    let chunk = TerminalChunk {
        session_id: session.id.clone(),
        seq: session.last_seq,
        direction,
        text,
        created_at: session.updated_at.clone(),
    };
    chunk
}

fn emit_chunk(app: &AppHandle, session_id: &str, chunk: TerminalChunk) {
    let _ = app.emit(
        TERMINAL_CHUNK_EVENT,
        TerminalChunkPayload {
            session_id: session_id.to_string(),
            chunk,
        },
    );
}

fn take_completed_lines(buffer: &mut String) -> String {
    let Some(idx) = buffer.rfind('\n') else {
        return String::new();
    };
    let completed = buffer[..=idx].to_string();
    let rest = buffer[idx + 1..].to_string();
    *buffer = rest;
    completed
}

fn strip_ansi(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            for next in chars.by_ref() {
                if next.is_ascii_alphabetic() || next == '~' {
                    break;
                }
            }
        } else if ch != '\r' {
            output.push(ch);
        }
    }
    output
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn mark_start_failed(db: &Db, session: &mut AgentSession) -> AelResult<()> {
    session.status = AgentSessionStatus::Failed;
    session.updated_at = now_iso();
    session.ended_at = Some(session.updated_at.clone());
    db.update_agent_session(session)
}

#[cfg(test)]
mod terminal_cache_tests {
    use super::*;

    #[test]
    fn terminal_cache_is_bounded_without_reusing_sequence_or_mutating_evidence() {
        let mut session = AgentSession {
            id: "synthetic-session".into(),
            task_id: "task".into(),
            profile_id: "codex".into(),
            agent_id: "codex".into(),
            status: AgentSessionStatus::Running,
            cwd: "fixture".into(),
            command_line: "fixture".into(),
            started_at: now_iso(),
            updated_at: now_iso(),
            ended_at: None,
            exit_code: None,
            last_seq: 0,
        };
        let mut cache = TerminalHistoryBuffer::default();
        for expected_seq in 1..=5000 {
            let original =
                next_terminal_chunk(&mut session, TerminalDirection::Output, "x".repeat(1024));
            cache.push(&original);
            assert_eq!(original.seq, expected_seq);
            assert_eq!(original.text.len(), 1024);
            assert!(cache.chunks.len() <= TERMINAL_PREVIEW_MAX_CHUNKS);
            assert!(cache.bytes <= TERMINAL_PREVIEW_MAX_BYTES);
        }
        assert_eq!(session.last_seq, 5000);
        assert!(cache.chunks.front().unwrap().seq > 1);
        let original = next_terminal_chunk(
            &mut session,
            TerminalDirection::Output,
            "界".repeat(1_000_000),
        );
        cache.push(&original);
        assert_eq!(original.text.len(), 3_000_000);
        assert_eq!(original.seq, 5001);
        assert_eq!(session.last_seq, 5001);
        assert!(cache.bytes <= TERMINAL_PREVIEW_MAX_BYTES);
        assert!(cache.chunks.back().unwrap().text.contains("完整记录保留"));
    }
}
