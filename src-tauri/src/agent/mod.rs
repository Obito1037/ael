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
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
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
            other => Err(AelError::internal(format!("非法 AgentSessionStatus: {other}"))),
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
            other => Err(AelError::internal(format!("非法 TerminalDirection: {other}"))),
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
            other => Err(AelError::internal(format!("非法 WorkspaceLockKind: {other}"))),
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
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    chunks: Vec<TerminalChunk>,
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
        let cwd = fs::canonicalize(&cwd).unwrap_or(cwd);

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

        session.status = AgentSessionStatus::Running;
        session.updated_at = now_iso();
        db.update_agent_session(&session)?;

        {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            sessions.insert(
                session_id.clone(),
                RuntimeSession {
                    session: session.clone(),
                    writer,
                    master: pair.master,
                    child,
                    chunks: Vec::new(),
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
                            let lines = state.agents.push_output_chunk(
                                &state.db,
                                &read_app,
                                &read_session_id,
                                text,
                            );
                            if !lines.trim().is_empty() {
                                state.agents.ingest_completed_lines(
                                    &read_app,
                                    &read_session_id,
                                    &lines,
                                );
                            }
                        } else {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }

            if let Some(state) = read_app.try_state::<crate::state::AppState>() {
                let _ = state.agents.mark_session_status(
                    &state.db,
                    &read_app,
                    &read_session_id,
                    AgentSessionStatus::Exited,
                    None,
                );
            }
        });

        // 启动上下文注入走 raw 通道,不经海关(否则可能被 prompt 里的示例命令误扣)。
        if let Some(prompt) = opts.initial_prompt {
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
        let is_submit = (text.contains('\n') || text.contains('\r')) && gate.apply_to_input();
        if !is_submit {
            // 单个控制键 / 半行输入:透传,不裁决。
            return self.send_input_raw(db, app, session_id, text);
        }

        let task_id = self.session_task_id(session_id)?;
        let command_line = text.trim().to_string();
        if command_line.is_empty() {
            return self.send_input_raw(db, app, session_id, text);
        }

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
                    &format!("[AEL·海关] 警告(规则 {rule}):{} · 已放行并留痕\r\n", verdict.reason),
                );
                Ok(())
            }
            PolicyAction::Hold => {
                let rule = verdict.rule_id.clone().unwrap_or_default();
                let pending = self.enqueue_hold(
                    session_id,
                    &task_id,
                    &text,
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
        let chunk = {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            let session = sessions
                .get_mut(session_id)
                .ok_or_else(|| AelError::not_found(format!("session {session_id} 不存在")))?;
            session.writer.write_all(text.as_bytes())?;
            session.writer.flush()?;
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
        {
            let mut sessions = self.sessions.lock().expect("agent runtime mutex poisoned");
            let session = sessions
                .get_mut(session_id)
                .ok_or_else(|| AelError::not_found(format!("session {session_id} 不存在")))?;
            if kill_tree {
                session
                    .child
                    .kill()
                    .map_err(|e| AelError::io_error(format!("停止 Agent 失败: {e}")))?;
            }
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
        let chunks = db.list_terminal_chunks(session_id, None)?;
        Ok(AgentSnapshot { session, chunks })
    }

    pub fn list_chunks(
        &self,
        db: &Db,
        session_id: &str,
        after_seq: Option<u64>,
    ) -> AelResult<Vec<TerminalChunk>> {
        db.list_terminal_chunks(session_id, after_seq)
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
            self.send_input_raw(db, app, &hold.session_id, hold.text.clone())?;
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
    pub fn budget_status(&self, db: &Db, gate: &PolicyGate, session_id: &str) -> AelResult<BudgetStatus> {
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

    fn push_output_chunk(&self, db: &Db, app: &AppHandle, session_id: &str, text: String) -> String {
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
    fn scan_signature_hits(&self, db: &Db, app: &AppHandle, session_id: &str, events: &[TaskEvent]) {
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
                AgentSessionStatus::Exited | AgentSessionStatus::Killed | AgentSessionStatus::Failed
            ) {
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
        version_args: &["-NoLogo", "-Command", "$PSVersionTable.PSVersion.ToString()"],
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
        default_args: spec.default_args.iter().map(|arg| arg.to_string()).collect(),
        available: path.is_some(),
        version,
        path: path.map(|p| p.to_string_lossy().to_string()),
    }
}

fn resolve_executable(name: &str) -> Option<PathBuf> {
    let candidate = PathBuf::from(name);
    if candidate.is_absolute() && candidate.exists() {
        return Some(candidate);
    }

    #[cfg(windows)]
    let output = Command::new("where.exe").arg(name).output().ok()?;
    #[cfg(not(windows))]
    let output = Command::new("which").arg(name).output().ok()?;

    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    stdout
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(PathBuf::from)
}

fn read_version(executable: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new(executable).args(args).output().ok()?;
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

fn make_chunk(session: &mut RuntimeSession, direction: TerminalDirection, text: String) -> TerminalChunk {
    session.session.last_seq += 1;
    session.session.updated_at = now_iso();
    let chunk = TerminalChunk {
        session_id: session.session.id.clone(),
        seq: session.session.last_seq,
        direction,
        text,
        created_at: session.session.updated_at.clone(),
    };
    session.chunks.push(chunk.clone());
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
