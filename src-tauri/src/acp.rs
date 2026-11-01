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
const CODEX_GOVERNED_MODE: &str = "read-only";
const CODEX_REASONING_EFFORT: &str = "medium";
const ACP_PERMISSION_RULE: &str = "acp.permission";

/// 权限请求里真正要执行的内容，用于海关规则匹配和界面展示。
fn permission_subject(tool_call: &Value) -> String {
    let command = tool_call.pointer("/rawInput/command");
    if let Some(text) = command.and_then(Value::as_str) {
        return text.to_string();
    }
    if let Some(parts) = command.and_then(Value::as_array) {
        return parts
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(" ");
    }
    let title = tool_call
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("工具调用");
    let paths = permission_paths(tool_call);
    if paths.is_empty() {
        title.to_string()
    } else {
        format!("{title}: {}", paths.join(", "))
    }
}

fn permission_paths(tool_call: &Value) -> Vec<&str> {
    tool_call
        .get("locations")
        .and_then(Value::as_array)
        .map(|locations| {
            locations
                .iter()
                .filter_map(|location| location.get("path").and_then(Value::as_str))
                .collect()
        })
        .unwrap_or_default()
}

fn touches_outside_workspace(tool_call: &Value, cwd: &str) -> bool {
    let root = PathBuf::from(cwd);
    permission_paths(tool_call)
        .iter()
        .any(|path| !PathBuf::from(path).starts_with(&root))
}

#[derive(Debug, PartialEq)]
enum PermissionRoute {
    Allow,
    Reject,
    AskHuman,
}

/// 和 PTY 海关同一套语义：未命中放行，warn 放行留痕，hold 等人工，deny 直接拒绝。
/// 工作区之外的写入规则看不出来，一律交给人。
fn route_permission(action: PolicyAction, outside_workspace: bool) -> PermissionRoute {
    match action {
        PolicyAction::Deny => PermissionRoute::Reject,
        PolicyAction::Hold => PermissionRoute::AskHuman,
        PolicyAction::Allow | PolicyAction::Warn if outside_workspace => PermissionRoute::AskHuman,
        PolicyAction::Allow | PolicyAction::Warn => PermissionRoute::Allow,
    }
}

fn allow_option(options: &[PermissionOptionView]) -> Option<String> {
    options
        .iter()
        .find(|option| option.kind == "allow_once")
        .or_else(|| options.iter().find(|option| option.kind == "allow_always"))
        .or_else(|| options.first())
        .map(|option| option.option_id.clone())
}

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
///
/// 适配器默认的 auto-review 模式由模型自行批准命令，AEL 收不到任何请求，
/// 海关形同虚设。read-only 模式下所有写操作都必须申请权限，从而经过海关。
fn spawn_args(
    profile_id: &str,
    local_codex: Option<PathBuf>,
    model: Option<&str>,
    inherited_config: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();
    if profile_id == "codex" {
        if let Some(path) = local_codex {
            args.push(format!("CODEX_PATH={}", path.display()));
        }
        args.push(format!("INITIAL_AGENT_MODE={CODEX_GOVERNED_MODE}"));
        if let Some(config) = codex_config(model, inherited_config) {
            args.push(format!("CODEX_CONFIG={config}"));
        }
    }
    args.extend(acp_args(profile_id).into_iter().map(str::to_owned));
    args
}

/// 选了模型就同时固定推理强度，否则会沿用全局配置里可能很贵的档位。
fn codex_config(model: Option<&str>, inherited: Option<&str>) -> Option<String> {
    let mut config = inherited
        .and_then(|text| serde_json::from_str::<Value>(text).ok())
        .filter(Value::is_object);
    if let Some(model) = model.map(str::trim).filter(|model| !model.is_empty()) {
        let object = config.get_or_insert_with(|| Value::Object(Default::default()));
        object["model"] = Value::String(model.to_string());
        object["model_reasoning_effort"] = Value::String(CODEX_REASONING_EFFORT.to_string());
    }
    config.map(|value| value.to_string())
}

fn agent_for(
    profile_id: &str,
    model: Option<&str>,
) -> Result<AcpAgent, agent_client_protocol::Error> {
    let local_codex = (profile_id == "codex")
        .then(|| crate::agent::resolve_executable("codex"))
        .flatten();
    let inherited = std::env::var("CODEX_CONFIG").ok();
    AcpAgent::from_args(spawn_args(
        profile_id,
        local_codex,
        model,
        inherited.as_deref(),
    ))
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
    rule_id: String,
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
        let tool_call = serde_json::to_value(&request.tool_call).unwrap_or(Value::Null);
        let subject = permission_subject(&tool_call);
        let Some(state) = app.try_state::<crate::state::AppState>() else {
            return RequestPermissionOutcome::Cancelled;
        };
        let verdict = state.gate.evaluate(&subject);
        let outside = state
            .db
            .get_agent_session(session_id)
            .map(|session| touches_outside_workspace(&tool_call, &session.cwd))
            .unwrap_or(true);
        let rule_id = verdict
            .rule_id
            .clone()
            .unwrap_or_else(|| ACP_PERMISSION_RULE.to_string());
        let command_text = format!("ACP 权限请求: {subject}");
        match route_permission(verdict.action, outside) {
            PermissionRoute::Allow => {
                let Some(option_id) = allow_option(&options) else {
                    return RequestPermissionOutcome::Cancelled;
                };
                record_policy_decision(
                    app,
                    &state.db,
                    NewPolicyDecision {
                        session_id: Some(session_id.to_string()),
                        task_id: Some(task_id.to_string()),
                        rule_id,
                        action: verdict.action,
                        verdict: if verdict.action == PolicyAction::Warn {
                            PolicyVerdictKind::Warned
                        } else {
                            PolicyVerdictKind::Passed
                        },
                        command_text,
                        reason: verdict.reason,
                        decided_by: DecidedBy::Policy,
                        resolved_at: Some(now_iso()),
                    },
                );
                emit_acp_output(
                    app,
                    session_id,
                    format!("\r\n[AEL·海关] 放行并留痕: {subject}\r\n"),
                );
                return RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                    option_id,
                ));
            }
            PermissionRoute::Reject => {
                record_policy_decision(
                    app,
                    &state.db,
                    NewPolicyDecision {
                        session_id: Some(session_id.to_string()),
                        task_id: Some(task_id.to_string()),
                        rule_id: rule_id.clone(),
                        action: verdict.action,
                        verdict: PolicyVerdictKind::AutoDenied,
                        command_text,
                        reason: verdict.reason,
                        decided_by: DecidedBy::Policy,
                        resolved_at: Some(now_iso()),
                    },
                );
                emit_acp_output(
                    app,
                    session_id,
                    format!("\r\n[AEL·海关] 已拦截(规则 {rule_id}): {subject}\r\n"),
                );
                return RequestPermissionOutcome::Cancelled;
            }
            PermissionRoute::AskHuman => {}
        }
        emit_acp_output(
            app,
            session_id,
            format!("\r\n[AEL·海关] 等待人工裁决(规则 {rule_id}): {subject}\r\n"),
        );
        let reason = if verdict.matched {
            verdict.reason
        } else {
            "写入范围超出工作区，等待人工裁决".to_string()
        };
        let id = Uuid::new_v4().to_string();
        let (response_tx, response_rx) = tokio::sync::oneshot::channel();
        let pending = PendingAcpPermission {
            rule_id,
            session_id: session_id.to_string(),
            task_id: task_id.to_string(),
            command_text,
            reason,
            created_at: now_iso(),
            options,
            response_tx,
        };
        let visible = PendingCommand {
            id: id.clone(),
            session_id: pending.session_id.clone(),
            task_id: pending.task_id.clone(),
            command_text: pending.command_text.clone(),
            rule_id: pending.rule_id.clone(),
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
                rule_id: pending.rule_id.clone(),
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
            rule_id: pending.rule_id,
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
pub fn run_json_prompt(
    profile_id: &str,
    cwd: PathBuf,
    prompt: String,
    model: Option<&str>,
) -> AelResult<String> {
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
        .block_on(run_json_prompt_async(profile_id, cwd, prompt, model))
        .map_err(|error| AelError::internal(format!("ACP JSON 提炼失败: {error}")))
}

async fn run_json_prompt_async(
    profile_id: &str,
    cwd: PathBuf,
    prompt: String,
    model: Option<&str>,
) -> Result<String, agent_client_protocol::Error> {
    let agent = agent_for(profile_id, model)?;
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
    let model = app
        .try_state::<crate::state::AppState>()
        .map(|state| state.settings_snapshot().codex_model);
    let agent = agent_for(&profile_id, model.as_deref())?;
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

fn record_policy_decision(app: &AppHandle, db: &Db, input: NewPolicyDecision) {
    if let Ok(decision) = db.insert_policy_decision(input) {
        let _ = app.emit(GATE_DECISION_EVENT, &decision);
    }
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
            ["/data/message", "/data/details", "/data", "/message"]
                .iter()
                .find_map(|path| value.pointer(path).and_then(Value::as_str))
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
    fn codex_sessions_never_start_in_the_self_approving_mode() {
        let args = spawn_args("codex", None, None, None);
        assert!(args.contains(&"INITIAL_AGENT_MODE=read-only".to_string()));
    }

    #[test]
    fn selected_model_overrides_inherited_config_and_fixes_effort() {
        let args = spawn_args(
            "codex",
            None,
            Some("gpt-5.6-luna"),
            Some(r#"{"model":"other","foo":1}"#),
        );
        let config = args
            .iter()
            .find_map(|arg| arg.strip_prefix("CODEX_CONFIG="))
            .expect("config passed");
        let config: Value = serde_json::from_str(config).unwrap();
        assert_eq!(config["model"], "gpt-5.6-luna");
        assert_eq!(config["model_reasoning_effort"], "medium");
        assert_eq!(config["foo"], 1);
    }

    #[test]
    fn empty_model_follows_the_agent_config() {
        assert_eq!(codex_config(Some("  "), None), None);
    }

    #[test]
    fn gate_rules_see_the_raw_command_not_escaped_json() {
        let tool_call = serde_json::json!({
            "title": "Run command",
            "rawInput": { "command": "powershell -Command \"Remove-Item -Recurse -Force victim\"" }
        });
        let subject = permission_subject(&tool_call);
        assert!(subject.contains("Remove-Item -Recurse -Force victim"));
        assert!(!subject.contains('{'));
    }

    #[test]
    fn edits_are_described_by_their_paths() {
        let tool_call = serde_json::json!({
            "title": "Edit files",
            "locations": [{ "path": "D:/repo/a.txt" }]
        });
        assert_eq!(permission_subject(&tool_call), "Edit files: D:/repo/a.txt");
    }

    #[test]
    fn writes_outside_the_workspace_are_detected() {
        let inside = serde_json::json!({ "locations": [{ "path": "D:/repo/src/a.txt" }] });
        let outside = serde_json::json!({ "locations": [{ "path": "D:/other/a.txt" }] });
        assert!(!touches_outside_workspace(&inside, "D:/repo"));
        assert!(touches_outside_workspace(&outside, "D:/repo"));
    }

    #[test]
    fn routing_follows_the_policy_action() {
        use PermissionRoute::*;
        assert_eq!(route_permission(PolicyAction::Allow, false), Allow);
        assert_eq!(route_permission(PolicyAction::Warn, false), Allow);
        assert_eq!(route_permission(PolicyAction::Hold, false), AskHuman);
        assert_eq!(route_permission(PolicyAction::Deny, false), Reject);
    }

    #[test]
    fn writes_outside_the_workspace_always_ask_a_human() {
        assert_eq!(
            route_permission(PolicyAction::Allow, true),
            PermissionRoute::AskHuman
        );
        assert_eq!(
            route_permission(PolicyAction::Deny, true),
            PermissionRoute::Reject
        );
    }

    #[test]
    fn automatic_approval_prefers_a_single_use_grant() {
        let option = |id: &str, kind: &str| PermissionOptionView {
            option_id: id.to_string(),
            name: id.to_string(),
            kind: kind.to_string(),
        };
        let options = [
            option("always", "allow_always"),
            option("once", "allow_once"),
        ];
        assert_eq!(allow_option(&options).as_deref(), Some("once"));
    }

    #[test]
    fn readable_error_extracts_the_message_and_hides_local_paths() {
        let detail = r#"Internal error: {"spawned_at":"C:\\Users\\x\\session.rs:1","data":{"message":"usage limit"}}"#;
        assert_eq!(readable_error(detail), "usage limit");
        assert_eq!(readable_error("process exited"), "process exited");
        assert_eq!(
            readable_error(r#"Internal error: {"data":{"details":"bad config"}}"#),
            "bad config"
        );
        assert_eq!(
            readable_error(r#"Internal error: {"data":"exit 1"}"#),
            "exit 1"
        );
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
        let args = spawn_args(
            "codex",
            Some(PathBuf::from("C:/Program Files/codex.exe")),
            None,
            None,
        );
        assert_eq!(args[0], "CODEX_PATH=C:/Program Files/codex.exe");
        assert!(AcpAgent::from_args(args).is_ok());
    }

    #[test]
    fn other_agents_ignore_the_local_codex_path() {
        let args = spawn_args("gemini", Some(PathBuf::from("codex.exe")), Some("m"), None);
        assert!(args[0].starts_with("gemini"));
    }

    #[test]
    fn codex_without_a_local_cli_uses_the_adapter_dependency() {
        let args = spawn_args("codex", None, None, None);
        assert!(args.iter().any(|arg| arg.starts_with("npx")));
    }
}
