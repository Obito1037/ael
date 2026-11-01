//! ACP 结构化 Agent 通道。
//!
//! PTY 仍作为兼容回退；支持 ACP 的 profile 在 auto 模式优先走这里，
//! 以获得消息、思考、工具调用和停止原因等结构化更新。

use crate::agent::{
    AgentSession, AgentSessionStatus, TerminalChunk, TerminalDirection, WorkspaceLockKind,
};
use crate::db::Db;
use crate::error::{AelError, AelResult};
use crate::models::{
    DecidedBy, NewPolicyDecision, PendingCommand, PermissionOptionView, PolicyAction,
    PolicyDecision, PolicyVerdictKind, TaskEvent,
};
use crate::util::now_iso;
use agent_client_protocol::schema::{
    v1::{
        InitializeRequest, RequestPermissionOutcome, RequestPermissionRequest,
        RequestPermissionResponse, SelectedPermissionOutcome, SessionNotification,
    },
    ProtocolVersion,
};
use agent_client_protocol::util::MatchDispatch;
use agent_client_protocol::{AcpAgent, Client, Responder};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::mpsc::{self, UnboundedReceiver, UnboundedSender};
use tokio::sync::oneshot;
use uuid::Uuid;

const TERMINAL_CHUNK_EVENT: &str = "agent://terminal-chunk";
const SESSION_STATUS_EVENT: &str = "agent://session-status";
const PARSED_EVENT_EVENT: &str = "agent://parsed-event";
const GATE_PENDING_EVENT: &str = "gate://pending";
const GATE_DECISION_EVENT: &str = "gate://decision";

// 适配器锁定版本：@latest 会让同一安装包在不同日期拉到不同依赖，出错后也无法复现。
const CODEX_ACP_PACKAGE: &str = "@agentclientprotocol/codex-acp@2.5.0";
const CLAUDE_ACP_PACKAGE: &str = "@agentclientprotocol/claude-agent-acp@0.99.1";

/// 等待 ACP 握手的上限。首次运行要下载适配器，超时后保留会话继续等待，不回退。
const ACP_READY_TIMEOUT: Duration = Duration::from_secs(120);

fn acp_args(profile_id: &str) -> Vec<&'static str> {
    match profile_id {
        "gemini" => vec![
            if cfg!(windows) {
                "gemini.cmd"
            } else {
                "gemini"
            },
            "--acp",
        ],
        "claude_code" => vec![
            if cfg!(windows) { "npx.cmd" } else { "npx" },
            "-y",
            CLAUDE_ACP_PACKAGE,
        ],
        _ => vec![
            if cfg!(windows) { "npx.cmd" } else { "npx" },
            "-y",
            CODEX_ACP_PACKAGE,
        ],
    }
}

fn command_line_for(profile_id: &str) -> String {
    acp_args(profile_id).join(" ")
}

/// 启动参数。Codex 优先用本机已登录的 CLI，而不是适配器自带的平台包，
/// 后者依赖 npm 可选依赖，在 npx 缓存里可能缺失。
fn spawn_args(profile_id: &str, local_codex: Option<PathBuf>) -> Vec<String> {
    let mut args = Vec::new();
    if profile_id == "codex" {
        if let Some(path) = local_codex {
            args.push(format!("CODEX_PATH={}", path.display()));
        }
    }
    args.extend(acp_args(profile_id).into_iter().map(str::to_owned));
    args
}

fn agent_for(profile_id: &str) -> Result<AcpAgent, agent_client_protocol::Error> {
    let local_codex = (profile_id == "codex")
        .then(|| crate::agent::resolve_executable("codex"))
        .flatten();
    AcpAgent::from_args(spawn_args(profile_id, local_codex))
        .map_err(|error| agent_client_protocol::util::internal_error(error.to_string()))
}

type ReadySender = Arc<Mutex<Option<oneshot::Sender<Result<(), String>>>>>;

fn notify_ready(ready: &ReadySender, result: Result<(), String>) {
    if let Some(sender) = ready.lock().expect("ACP ready mutex poisoned").take() {
        let _ = sender.send(result);
    }
}

/// 启动结果的等待句柄。
pub struct AcpStart {
    pub session: AgentSession,
    ready: oneshot::Receiver<Result<(), String>>,
}

impl AcpStart {
    /// 握手失败时返回错误原因，调用方据此回退到 PTY。
    pub async fn wait_ready(self) -> Result<AgentSession, String> {
        match tokio::time::timeout(ACP_READY_TIMEOUT, self.ready).await {
            Ok(Ok(Err(reason))) => Err(reason),
            _ => Ok(self.session),
        }
    }
}

#[derive(Debug)]
enum AcpCommand {
    Prompt(String),
    Stop,
}

struct PendingAcpPermission {
    session_id: String,
    task_id: String,
    command_text: String,
    reason: String,
    created_at: String,
    options: Vec<PermissionOptionView>,
    response_tx: tokio::sync::oneshot::Sender<Option<String>>,
}

struct AcpSessionState {
    session: AgentSession,
    tx: UnboundedSender<AcpCommand>,
    stop_requested: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct AcpRuntime {
    sessions: Mutex<HashMap<String, AcpSessionState>>,
    input_buffers: Mutex<HashMap<String, String>>,
    permissions: Mutex<HashMap<String, PendingAcpPermission>>,
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

#[derive(Debug, Clone, Copy)]
enum AcpEnd {
    Exited,
    Stopped,
}

impl AcpRuntime {
    pub fn supports(profile_id: &str) -> bool {
        matches!(profile_id, "codex" | "claude_code" | "gemini")
    }

    pub fn command_available_for(profile_id: &str) -> bool {
        let (command, argument) = match profile_id {
            "gemini" => (
                if cfg!(windows) {
                    "gemini.cmd"
                } else {
                    "gemini"
                },
                "--version",
            ),
            _ => (if cfg!(windows) { "npx.cmd" } else { "npx" }, "--version"),
        };
        std::process::Command::new(command)
            .arg(argument)
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    pub fn contains(&self, session_id: &str) -> bool {
        self.sessions
            .lock()
            .expect("ACP session mutex poisoned")
            .contains_key(session_id)
    }

    /// ACP 原生权限请求与 PTY 海关共用一条待人工裁决队列。
    ///
    /// ACP agent 在收到请求后会等待这个 future；没有人工决定时绝不自动放行。
    async fn wait_for_permission(
        &self,
        app: &AppHandle,
        session_id: &str,
        task_id: &str,
        request: RequestPermissionRequest,
    ) -> RequestPermissionOutcome {
        let options = request
            .options
            .iter()
            .map(|option| PermissionOptionView {
                option_id: option.option_id.to_string(),
                name: option.name.clone(),
                kind: serde_json::to_value(option.kind)
                    .ok()
                    .and_then(|value| value.as_str().map(str::to_owned))
                    .unwrap_or_else(|| format!("{:?}", option.kind)),
            })
            .collect::<Vec<_>>();
        let command_text = serde_json::to_string(&request.tool_call)
            .unwrap_or_else(|_| "ACP 工具调用".to_string());
        let id = Uuid::new_v4().to_string();
        let (response_tx, response_rx) = tokio::sync::oneshot::channel();
        let pending = PendingAcpPermission {
            session_id: session_id.to_string(),
            task_id: task_id.to_string(),
            command_text: format!("ACP 权限请求: {command_text}"),
            reason: "ACP 原生权限请求，等待人工裁决".to_string(),
            created_at: now_iso(),
            options,
            response_tx,
        };
        let visible = PendingCommand {
            id: id.clone(),
            session_id: pending.session_id.clone(),
            task_id: pending.task_id.clone(),
            command_text: pending.command_text.clone(),
            rule_id: "acp.permission".to_string(),
            reason: pending.reason.clone(),
            created_at: pending.created_at.clone(),
            timeout_secs: 0,
            permission_options: pending.options.clone(),
        };
        self.permissions
            .lock()
            .expect("ACP permission mutex poisoned")
            .insert(id, pending);
        let _ = app.emit(GATE_PENDING_EVENT, &visible);

        match response_rx.await.ok().flatten() {
            Some(option_id) => {
                RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option_id))
            }
            None => RequestPermissionOutcome::Cancelled,
        }
    }

    pub fn list_pending_permissions(&self) -> Vec<PendingCommand> {
        self.permissions
            .lock()
            .expect("ACP permission mutex poisoned")
            .iter()
            .map(|(id, pending)| PendingCommand {
                id: id.clone(),
                session_id: pending.session_id.clone(),
                task_id: pending.task_id.clone(),
                command_text: pending.command_text.clone(),
                rule_id: "acp.permission".to_string(),
                reason: pending.reason.clone(),
                created_at: pending.created_at.clone(),
                timeout_secs: 0,
                permission_options: pending.options.clone(),
            })
            .collect()
    }

    pub fn resolve_permission(
        &self,
        db: &Db,
        app: &AppHandle,
        pending_id: &str,
        approve: bool,
    ) -> AelResult<PolicyDecision> {
        let pending = self
            .permissions
            .lock()
            .expect("ACP permission mutex poisoned")
            .remove(pending_id)
            .ok_or_else(|| {
                AelError::not_found(format!("ACP 待裁决请求 {pending_id} 不存在或已处理"))
            })?;
        let selected = approve
            .then(|| {
                pending
                    .options
                    .iter()
                    .find(|option| option.kind == "allow_once" || option.kind == "allow_always")
                    .map(|option| option.option_id.clone())
                    .or_else(|| {
                        pending
                            .options
                            .first()
                            .map(|option| option.option_id.clone())
                    })
            })
            .flatten();
        let _ = pending.response_tx.send(selected);
        let decision = db.insert_policy_decision(NewPolicyDecision {
            session_id: Some(pending.session_id),
            task_id: Some(pending.task_id),
            rule_id: "acp.permission".to_string(),
            action: PolicyAction::Hold,
            verdict: if approve {
                PolicyVerdictKind::Approved
            } else {
                PolicyVerdictKind::Denied
            },
            command_text: pending.command_text,
            reason: pending.reason,
            decided_by: DecidedBy::Human,
            resolved_at: Some(now_iso()),
        })?;
        let _ = app.emit(GATE_DECISION_EVENT, &decision);
        Ok(decision)
    }

    fn cancel_permissions_for_session(&self, session_id: &str) {
        let ids = self
            .permissions
            .lock()
            .expect("ACP permission mutex poisoned")
            .iter()
            .filter(|(_, pending)| pending.session_id == session_id)
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>();
        let mut permissions = self
            .permissions
            .lock()
            .expect("ACP permission mutex poisoned");
        for id in ids {
            if let Some(pending) = permissions.remove(&id) {
                let _ = pending.response_tx.send(None);
            }
        }
    }

    pub fn start_session(
        &self,
        app: AppHandle,
        db: &Db,
        task_id: String,
        profile_id: String,
        cwd: Option<String>,
        initial_prompt: Option<String>,
        lock_workspace: Option<bool>,
    ) -> AelResult<AcpStart> {
        if !Self::supports(&profile_id) {
            return Err(AelError::invalid_input(format!(
                "profile {profile_id} 暂不支持 ACP"
            )));
        }
        let cwd = cwd.map(PathBuf::from).unwrap_or(std::env::current_dir()?);
        if !cwd.exists() {
            return Err(AelError::not_found(format!(
                "工作目录不存在: {}",
                cwd.display()
            )));
        }
        let cwd = crate::util::canonical_working_dir(&cwd);
        let now = now_iso();
        let id = Uuid::new_v4().to_string();
        let command_line = command_line_for(&profile_id);
        let mut session = AgentSession {
            id: id.clone(),
            task_id,
            profile_id: profile_id.clone(),
            agent_id: profile_id.clone(),
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
        if lock_workspace.unwrap_or(true) {
            if let Err(error) =
                db.acquire_workspace_lock(&session.cwd, &session.id, WorkspaceLockKind::Write)
            {
                session.status = AgentSessionStatus::Failed;
                session.updated_at = now_iso();
                let _ = db.update_agent_session(&session);
                return Err(error);
            }
        }
        let (tx, rx) = mpsc::unbounded_channel();
        let stop_requested = Arc::new(AtomicBool::new(false));
        let (ready_tx, ready) = oneshot::channel();
        let ready_tx: ReadySender = Arc::new(Mutex::new(Some(ready_tx)));
        self.sessions
            .lock()
            .expect("ACP session mutex poisoned")
            .insert(
                id.clone(),
                AcpSessionState {
                    session: session.clone(),
                    tx,
                    stop_requested: stop_requested.clone(),
                },
            );

        let worker_app = app.clone();
        let worker_id = id.clone();
        let worker_task_id = session.task_id.clone();
        let worker_profile = profile_id;
        let worker_cwd = cwd.to_string_lossy().to_string();
        thread::spawn(move || {
            let runtime = match tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                Ok(runtime) => runtime,
                Err(error) => {
                    let detail = format!("创建 ACP 运行时失败: {error}");
                    mark_failed(&worker_app, &worker_id, detail.clone());
                    notify_ready(&ready_tx, Err(detail));
                    return;
                }
            };
            let result = runtime.block_on(run_connection(
                worker_app.clone(),
                worker_id.clone(),
                worker_task_id,
                worker_profile,
                worker_cwd,
                initial_prompt,
                rx,
                stop_requested,
                ready_tx.clone(),
            ));
            match result {
                Ok(AcpEnd::Stopped) => {
                    mark_terminal(&worker_app, &worker_id, AgentSessionStatus::Killed)
                }
                Ok(AcpEnd::Exited) => {
                    mark_terminal(&worker_app, &worker_id, AgentSessionStatus::Exited)
                }
                Err(error) => {
                    let detail = error.to_string();
                    mark_failed(&worker_app, &worker_id, detail.clone());
                    notify_ready(&ready_tx, Err(detail));
                }
            }
        });

        Ok(AcpStart { session, ready })
    }

    pub fn send_input(
        &self,
        app: &AppHandle,
        db: &Db,
        session_id: &str,
        text: String,
    ) -> AelResult<()> {
        let tx = {
            let sessions = self.sessions.lock().expect("ACP session mutex poisoned");
            let session = sessions
                .get(session_id)
                .ok_or_else(|| AelError::not_found(format!("ACP session {session_id} 不存在")))?;
            if matches!(
                session.session.status,
                AgentSessionStatus::Exited
                    | AgentSessionStatus::Killed
                    | AgentSessionStatus::Failed
            ) {
                return Err(AelError::conflict("ACP 会话已经结束"));
            }
            session.tx.clone()
        };
        // xterm 按键事件是逐字符到达的；ACP 的 prompt 是按回车提交的消息。
        // 先在本地形成一行，避免把每个字符误发成一次独立任务。
        let (display_text, prompt) = {
            let mut buffers = self.input_buffers.lock().expect("ACP input mutex poisoned");
            let buffer = buffers.entry(session_id.to_string()).or_default();
            buffer.push_str(&text);
            if text.contains('\r') || text.contains('\n') {
                let prompt = buffer.trim().to_string();
                buffer.clear();
                (text, (!prompt.is_empty()).then_some(prompt))
            } else {
                (text, None)
            }
        };
        let chunk = self.next_chunk(session_id, TerminalDirection::Input, display_text)?;
        persist_and_emit(app, db, chunk);
        if let Some(prompt) = prompt {
            tx.send(AcpCommand::Prompt(prompt))
                .map_err(|_| AelError::conflict("ACP 会话通道已关闭"))?;
        }
        Ok(())
    }

    pub fn stop_session(
        &self,
        app: &AppHandle,
        db: &Db,
        session_id: &str,
    ) -> AelResult<AgentSession> {
        let state = self.sessions.lock().expect("ACP session mutex poisoned");
        let session = state
            .get(session_id)
            .ok_or_else(|| AelError::not_found(format!("ACP session {session_id} 不存在")))?;
        if matches!(
            session.session.status,
            AgentSessionStatus::Exited | AgentSessionStatus::Killed | AgentSessionStatus::Failed
        ) {
            return Ok(session.session.clone());
        }
        session.stop_requested.store(true, Ordering::Release);
        self.cancel_permissions_for_session(session_id);
        if session.tx.send(AcpCommand::Stop).is_err() {
            // Worker 可能刚刚自然结束；以数据库终态为准，重复点击“停止”应当幂等。
            let current = db.get_agent_session(session_id)?;
            if matches!(
                current.status,
                AgentSessionStatus::Exited
                    | AgentSessionStatus::Killed
                    | AgentSessionStatus::Failed
            ) {
                return Ok(current);
            }
            return Err(AelError::conflict("ACP 会话通道已关闭"));
        }
        drop(state);
        self.input_buffers
            .lock()
            .expect("ACP input mutex poisoned")
            .remove(session_id);
        mark_terminal(app, session_id, AgentSessionStatus::Killed);
        db.get_agent_session(session_id)
    }

    pub fn next_chunk(
        &self,
        session_id: &str,
        direction: TerminalDirection,
        text: String,
    ) -> AelResult<TerminalChunk> {
        let mut sessions = self.sessions.lock().expect("ACP session mutex poisoned");
        let state = sessions
            .get_mut(session_id)
            .ok_or_else(|| AelError::not_found(format!("ACP session {session_id} 不存在")))?;
        state.session.last_seq += 1;
        state.session.updated_at = now_iso();
        Ok(TerminalChunk {
            session_id: session_id.to_string(),
            seq: state.session.last_seq,
            direction,
            text,
            created_at: state.session.updated_at.clone(),
        })
    }
}

/// 使用用户本机已登录的 ACP Agent 做一次同步 JSON 提炼。
///
/// 这条路径只用于候选生成，不写 active 记忆；调用方必须继续做 JSON 校验、
/// 来源校验和人工审核。AEL 不直接调用模型供应商 API，也不接触 API Key。
pub fn run_json_prompt(profile_id: &str, cwd: PathBuf, prompt: String) -> AelResult<String> {
    if !AcpRuntime::supports(profile_id) {
        return Err(AelError::invalid_input(format!(
            "profile {profile_id} 暂不支持 ACP JSON 提炼"
        )));
    }
    if !AcpRuntime::command_available_for(profile_id) {
        return Err(AelError::not_found(format!(
            "ACP JSON 提炼需要可用的 {profile_id} Agent 命令"
        )));
    }
    if !cwd.exists() {
        return Err(AelError::not_found(format!(
            "工作目录不存在: {}",
            cwd.display()
        )));
    }
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .map_err(|error| AelError::internal(format!("创建 ACP JSON 运行时失败: {error}")))?;
    runtime
        .block_on(run_json_prompt_async(profile_id, cwd, prompt))
        .map_err(|error| AelError::internal(format!("ACP JSON 提炼失败: {error}")))
}

async fn run_json_prompt_async(
    profile_id: &str,
    cwd: PathBuf,
    prompt: String,
) -> Result<String, agent_client_protocol::Error> {
    let agent = agent_for(profile_id)?;
    Client
        .builder()
        .name("ael3")
        // 候选提炼没有可交互的本地任务页；安全起见，原生权限请求直接取消，
        // 避免后台 JSON 调用永久等待或意外放行。
        .on_receive_request(
            async |_request: RequestPermissionRequest,
                   responder: Responder<RequestPermissionResponse>,
                   _cx| {
                responder.respond(RequestPermissionResponse::new(
                    RequestPermissionOutcome::Cancelled,
                ))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, async move |cx| {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            let mut session = cx.build_session(cwd).block_task().start_session().await?;
            session.send_prompt(prompt)?;
            let mut output = String::new();
            loop {
                match session.read_update().await? {
                    agent_client_protocol::SessionMessage::StopReason(_) => break,
                    agent_client_protocol::SessionMessage::SessionMessage(dispatch) => {
                        let text = Arc::new(Mutex::new(String::new()));
                        let text_for_notification = text.clone();
                        MatchDispatch::new(dispatch)
                            .if_notification(async move |notification: SessionNotification| {
                                let value = serde_json::to_value(&notification.update)
                                    .unwrap_or(Value::Null);
                                let kind = value
                                    .get("sessionUpdate")
                                    .and_then(Value::as_str)
                                    .unwrap_or_default();
                                // 思考/工具流不混入 JSON 结果，避免污染解析。
                                if kind == "agent_message_chunk" {
                                    let mut chunk = String::new();
                                    collect_text(&value, &mut chunk);
                                    text_for_notification
                                        .lock()
                                        .expect("ACP JSON text mutex poisoned")
                                        .push_str(&chunk);
                                }
                                Ok(())
                            })
                            .await
                            .otherwise_ignore()?;
                        output.push_str(&text.lock().expect("ACP JSON text mutex poisoned"));
                    }
                    _ => {}
                }
            }
            Ok(output)
        })
        .await
}

async fn run_connection(
    app: AppHandle,
    session_id: String,
    task_id: String,
    profile_id: String,
    cwd: String,
    initial_prompt: Option<String>,
    mut rx: UnboundedReceiver<AcpCommand>,
    stop_requested: Arc<AtomicBool>,
    ready: ReadySender,
) -> Result<AcpEnd, agent_client_protocol::Error> {
    let agent = agent_for(&profile_id)?;
    let permission_app = app.clone();
    let permission_session_id = session_id.clone();
    let permission_task_id = task_id.clone();
    let stopped = stop_requested.clone();
    Client.builder()
        .name("ael3")
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder: Responder<RequestPermissionResponse>, _cx| {
                let outcome = if let Some(state) = permission_app.try_state::<crate::state::AppState>() {
                    state.acp.wait_for_permission(
                        &permission_app,
                        &permission_session_id,
                        &permission_task_id,
                        request,
                    ).await
                } else {
                    RequestPermissionOutcome::Cancelled
                };
                responder.respond(RequestPermissionResponse::new(outcome))
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, async move |cx| {
            cx.send_request(InitializeRequest::new(ProtocolVersion::V1)).block_task().await?;
            let mut session = cx.build_session(PathBuf::from(&cwd)).block_task().start_session().await?;
            mark_running(&app, &session_id);
            notify_ready(&ready, Ok(()));
            let mut next_prompt = initial_prompt;
            let mut pending_prompts: VecDeque<String> = VecDeque::new();
            let evidence_pending = Arc::new(Mutex::new(String::new()));
            loop {
                let prompt = match next_prompt.take().or_else(|| pending_prompts.pop_front()) {
                    Some(prompt) => prompt,
                    None => match rx.recv().await {
                        Some(AcpCommand::Prompt(prompt)) => prompt,
                        Some(AcpCommand::Stop) | None => return Ok(()),
                    },
                };
                if stopped.load(Ordering::Acquire) {
                    return Ok(());
                }
                session.send_prompt(prompt)?;
                loop {
                    let update = tokio::select! {
                        update = session.read_update() => update?,
                        command = rx.recv() => match command {
                            Some(AcpCommand::Prompt(prompt)) => {
                                // ACP v1 一次只能有一个活动 prompt；把用户在运行期间输入的
                                // 下一条消息排队，当前 turn 完成后再提交。
                                pending_prompts.push_back(prompt);
                                continue;
                            }
                            Some(AcpCommand::Stop) | None => {
                                flush_acp_evidence(&app, &session_id, &profile_id, &evidence_pending);
                                return Ok(());
                            }
                        },
                    };
                    match update {
                        agent_client_protocol::SessionMessage::StopReason(_) => {
                            flush_acp_evidence(&app, &session_id, &profile_id, &evidence_pending);
                            break;
                        }
                        agent_client_protocol::SessionMessage::SessionMessage(dispatch) => {
                            let app_for_update = app.clone();
                            let id_for_update = session_id.clone();
                            let agent_for_update = profile_id.clone();
                            let evidence_for_update = evidence_pending.clone();
                            MatchDispatch::new(dispatch)
                                .if_notification(async move |notification: SessionNotification| {
                                    let value = serde_json::to_value(&notification.update).unwrap_or(Value::Null);
                                    let kind = value.get("sessionUpdate").and_then(Value::as_str).unwrap_or("agent_update");
                                    let mut text = String::new();
                                    collect_text(&value, &mut text);
                                    let label = match kind {
                                        "agent_thought_chunk" => "[思考] ",
                                        "tool_call" | "tool_call_update" => "[工具] ",
                                        "plan" => "[计划] ",
                                        "usage_update" => "[用量] ",
                                        _ => "",
                                    };
                                    if !text.trim().is_empty() {
                                        // UI 仍保留流式输出；证据链只在完整行出现时写入，
                                        // 避免每个 delta 生成一条碎片事件。
                                        let evidence_line = format!("{label}{text}\n");
                                        let complete = {
                                            let mut pending = evidence_for_update
                                                .lock()
                                                .expect("ACP evidence mutex poisoned");
                                            pending.push_str(&evidence_line);
                                            take_completed_lines(&mut pending)
                                        };
                                        if !complete.trim().is_empty() {
                                            ingest_acp_lines(&app_for_update, &id_for_update, &agent_for_update, &complete);
                                        }
                                        emit_acp_output(&app_for_update, &id_for_update, format!("{label}{text}"));
                                    }
                                    Ok(())
                                })
                                .await
                                .otherwise_ignore()?;
                            if stopped.load(Ordering::Acquire) {
                                return Ok(());
                            }
                        }
                        _ => {}
                    }
                }
            }
        })
        .await?;
    if stop_requested.load(Ordering::Acquire) {
        Ok(AcpEnd::Stopped)
    } else {
        Ok(AcpEnd::Exited)
    }
}

fn collect_text(value: &Value, output: &mut String) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if key == "text" {
                    if let Some(text) = child.as_str() {
                        output.push_str(text);
                    }
                } else {
                    collect_text(child, output);
                }
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_text(child, output);
            }
        }
        _ => {}
    }
}

fn emit_acp_output(app: &AppHandle, session_id: &str, text: String) {
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let chunk = match state
        .acp
        .next_chunk(session_id, TerminalDirection::Output, text)
    {
        Ok(chunk) => chunk,
        Err(_) => return,
    };
    persist_and_emit(app, &state.db, chunk);
}

fn take_completed_lines(buffer: &mut String) -> String {
    let Some(end) = buffer.rfind('\n') else {
        return String::new();
    };
    buffer.drain(..=end).collect()
}

fn flush_acp_evidence(
    app: &AppHandle,
    session_id: &str,
    agent_id: &str,
    pending: &Arc<Mutex<String>>,
) {
    let tail = std::mem::take(&mut *pending.lock().expect("ACP evidence mutex poisoned"));
    if !tail.trim().is_empty() {
        ingest_acp_lines(app, session_id, agent_id, &tail);
    }
}

fn ingest_acp_lines(app: &AppHandle, session_id: &str, agent_id: &str, raw: &str) {
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let Ok(session) = state.db.get_agent_session(session_id) else {
        return;
    };
    match crate::adapter::ingest(&state.db, &session.task_id, agent_id, Some(session_id), raw) {
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
            log::warn!("ACP evidence ingest skipped for {session_id}: {error}");
        }
    }
}

fn persist_and_emit(app: &AppHandle, db: &Db, chunk: TerminalChunk) {
    let redact_on = app
        .try_state::<crate::state::AppState>()
        .map(|state| state.gate.redaction_enabled())
        .unwrap_or(true);
    let to_store = if redact_on {
        TerminalChunk {
            text: crate::engine::redact::redact(&chunk.text),
            ..chunk.clone()
        }
    } else {
        chunk.clone()
    };
    let _ = db.append_terminal_chunk(&to_store);
    let _ = app.emit(
        TERMINAL_CHUNK_EVENT,
        TerminalChunkPayload {
            session_id: chunk.session_id.clone(),
            chunk,
        },
    );
}

fn mark_running(app: &AppHandle, session_id: &str) {
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let _ = update_status(app, &state.db, session_id, AgentSessionStatus::Running);
}

fn mark_terminal(app: &AppHandle, session_id: &str, status: AgentSessionStatus) {
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        return;
    };
    let _ = update_status(app, &state.db, session_id, status);
    let _ = state.db.release_workspace_locks_for_session(session_id);
}

/// SDK 的错误文本里混着 JSON 和本机源码路径；优先取出其中给人看的 message。
fn readable_error(detail: &str) -> String {
    detail
        .find('{')
        .and_then(|start| serde_json::from_str::<Value>(&detail[start..]).ok())
        .and_then(|value| {
            value
                .pointer("/data/message")
                .or_else(|| value.get("message"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| detail.to_string())
}

fn mark_failed(app: &AppHandle, session_id: &str, detail: String) {
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        let _ = update_status(app, &state.db, session_id, AgentSessionStatus::Failed);
        let _ = state.db.release_workspace_locks_for_session(session_id);
        emit_acp_output(
            app,
            session_id,
            format!("[ACP 错误] {}\r\n", readable_error(&detail)),
        );
    }
}

fn update_status(
    app: &AppHandle,
    db: &Db,
    session_id: &str,
    status: AgentSessionStatus,
) -> AelResult<AgentSession> {
    let mut session = db.get_agent_session(session_id)?;
    if matches!(
        session.status,
        AgentSessionStatus::Exited | AgentSessionStatus::Killed | AgentSessionStatus::Failed
    ) && !matches!(status, AgentSessionStatus::Failed)
    {
        return Ok(session);
    }
    session.status = status;
    session.updated_at = now_iso();
    if matches!(
        session.status,
        AgentSessionStatus::Exited | AgentSessionStatus::Killed | AgentSessionStatus::Failed
    ) {
        session.ended_at = Some(session.updated_at.clone());
    }
    db.update_agent_session(&session)?;
    if let Some(state) = app.try_state::<crate::state::AppState>() {
        if let Ok(mut sessions) = state.acp.sessions.lock() {
            if let Some(acp) = sessions.get_mut(session_id) {
                acp.session = session.clone();
            }
        }
    }
    let _ = app.emit(
        SESSION_STATUS_EVENT,
        SessionStatusPayload {
            session_id: session_id.to_string(),
            session: session.clone(),
        },
    );
    Ok(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_error_extracts_the_message_and_hides_local_paths() {
        let detail = r#"Internal error: {"spawned_at":"C:\\Users\\x\\session.rs:1","data":{"message":"usage limit"}}"#;
        assert_eq!(readable_error(detail), "usage limit");
        assert_eq!(readable_error("process exited"), "process exited");
    }

    #[test]
    fn adapters_are_pinned_to_exact_versions() {
        for profile in ["codex", "claude_code"] {
            let line = command_line_for(profile);
            assert!(!line.contains("@latest"), "{line}");
        }
    }

    #[test]
    fn codex_uses_the_local_cli_when_one_is_found() {
        let args = spawn_args("codex", Some(PathBuf::from("C:/Program Files/codex.exe")));
        assert_eq!(args[0], "CODEX_PATH=C:/Program Files/codex.exe");
        assert!(AcpAgent::from_args(args).is_ok());
    }

    #[test]
    fn other_agents_ignore_the_local_codex_path() {
        let args = spawn_args("gemini", Some(PathBuf::from("codex.exe")));
        assert!(!args[0].starts_with("CODEX_PATH="));
    }

    #[test]
    fn codex_without_a_local_cli_uses_the_adapter_dependency() {
        let args = spawn_args("codex", None);
        assert!(args[0].starts_with("npx"));
    }
}
