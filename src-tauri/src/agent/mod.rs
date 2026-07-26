//! 多 Agent 运行时。负责发现/启动/管理 Codex、Claude Code 等交互式 CLI。
//!
//! 设计目标:
//! - 用 PTY 而不是普通 stdout 管道,保留交互式 CLI 的 TTY 行为。
//! - 所有终端输入输出都进入 transcript,并通过 Tauri event 实时推给前端。
//! - 输出按行复用 adapter 层沉淀为 task_events,让现有 Failure Guard / Skill / handover 链路继续工作。

pub mod compress;
pub mod config;
pub mod context;
pub mod usage;

use crate::adapter;
use crate::db::Db;
use crate::error::{AelError, AelResult};
use crate::models::TaskEvent;
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

struct RuntimeSession {
    session: AgentSession,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    chunks: Vec<TerminalChunk>,
    pending_output: String,
    auto_ingest: bool,
}

#[derive(Default)]
pub struct AgentRuntime {
    sessions: Mutex<HashMap<String, RuntimeSession>>,
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

        if let Some(prompt) = opts.initial_prompt {
            if !prompt.trim().is_empty() {
                self.send_input(db, &app, &session_id, format!("{prompt}\r\n"))?;
            }
        }

        Ok(session)
    }

    pub fn send_input(
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
            make_chunk(session, TerminalDirection::Input, text)
        };
        db.append_terminal_chunk(&chunk)?;
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
            let chunk = make_chunk(session, TerminalDirection::Output, text.clone());
            let clean = strip_ansi(&text);
            session.pending_output.push_str(&clean);
            let completed = take_completed_lines(&mut session.pending_output);
            (chunk, completed)
        };
        if let Err(error) = db.append_terminal_chunk(&chunk) {
            let _ = self.push_system_chunk(
                db,
                app,
                session_id,
                &format!("AEL transcript persist failed: {error}\r\n"),
            );
        }
        emit_chunk(app, session_id, chunk);
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
        db.append_terminal_chunk(&chunk)?;
        emit_chunk(app, session_id, chunk);
        Ok(())
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
        match adapter::ingest(&state.db, &task_id, &agent_id, lines) {
            Ok(events) => {
                for event in events {
                    let _ = app.emit(
                        PARSED_EVENT_EVENT,
                        ParsedEventPayload {
                            session_id: session_id.to_string(),
                            event,
                        },
                    );
                }
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

fn make_chunk(
    session: &mut RuntimeSession,
    direction: TerminalDirection,
    text: String,
) -> TerminalChunk {
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
            while let Some(next) = chars.next() {
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
