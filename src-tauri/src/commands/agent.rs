//! Agent Runtime IPC。把前端操作转成后端 PTY 会话管理。

use crate::acp::AcpRuntime;
use crate::agent::compress::{compress_text, CompressMode, CompressResult};
use crate::agent::config::{
    backup_config_target, list_config_targets, read_config_target, write_config_target,
    AgentConfigContent, AgentConfigTarget, AgentConfigWriteResult,
};
use crate::agent::context::{
    build_agent_startup_context as build_context, AgentStartupContext,
    BuildAgentStartupContextOptions,
};
use crate::agent::usage::{
    estimate_tokens, session_token_usage, transcript_text, SessionTokenUsage,
};
use crate::agent::{
    AgentProfile, AgentSession, AgentSnapshot, StartAgentOptions, TerminalChunk, WorkspaceLock,
};
use crate::error::{AelError, AelResult};
use crate::state::AppState;
use tauri::{AppHandle, Manager, State};

#[tauri::command]
pub fn detect_agents(state: State<AppState>) -> AelResult<Vec<AgentProfile>> {
    state.agents.detect_and_persist_profiles(&state.db)
}

// 异步命令：ACP 握手可能耗时数十秒，同步命令会卡住窗口主线程。
#[tauri::command]
pub async fn start_agent_session(
    app: AppHandle,
    state: State<'_, AppState>,
    task_id: String,
    profile_id: String,
    cwd: Option<String>,
    args: Option<Vec<String>>,
    initial_prompt: Option<String>,
    executable: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
    auto_ingest: Option<bool>,
    lock_workspace: Option<bool>,
    runtime: Option<String>,
) -> AelResult<AgentSession> {
    let runtime = runtime.as_deref().unwrap_or("auto");
    let wants_acp = runtime == "acp" || (runtime == "auto" && AcpRuntime::supports(&profile_id));
    if wants_acp
        && AcpRuntime::supports(&profile_id)
        && AcpRuntime::command_available_for(&profile_id)
    {
        let start = state.acp.start_session(
            app.clone(),
            &state.db,
            task_id.clone(),
            profile_id.clone(),
            cwd.clone(),
            initial_prompt.clone(),
            lock_workspace,
        )?;
        match start.wait_ready().await {
            // 握手期间状态已变；返回最新记录，避免前端用旧的 starting 覆盖 running。
            Ok(session) => return state.db.get_agent_session(&session.id),
            // 失败的 ACP 会话连同错误原因留在列表里；auto 模式继续走 PTY。
            Err(reason) if runtime == "acp" => {
                return Err(AelError::internal(format!("ACP 启动失败: {reason}")));
            }
            Err(_) => {}
        }
    } else if runtime == "acp" {
        return Err(AelError::not_found(
            "ACP 通道需要可用的 npx；请安装 Node.js，或选择 PTY 回退",
        ));
    }
    state.agents.start_session(
        app,
        &state.db,
        StartAgentOptions {
            task_id,
            profile_id,
            cwd,
            args,
            initial_prompt,
            executable,
            rows,
            cols,
            auto_ingest,
            lock_workspace,
        },
    )
}

#[tauri::command]
pub fn build_agent_startup_context(
    state: State<AppState>,
    task_id: String,
    agent_kind: Option<String>,
    profile_id: Option<String>,
    manual_note: Option<String>,
    event_limit: Option<usize>,
    skill_limit: Option<usize>,
    include_guard: Option<bool>,
    include_skills: Option<bool>,
    include_handover: Option<bool>,
    token_budget: Option<u64>,
) -> AelResult<AgentStartupContext> {
    let settings = state.settings_snapshot();
    build_context(
        &state.db,
        &task_id,
        BuildAgentStartupContextOptions {
            agent_kind,
            profile_id,
            manual_note,
            event_limit,
            skill_limit,
            include_guard,
            include_skills,
            include_handover,
            token_budget,
        },
        &settings,
    )
}

#[tauri::command]
pub fn build_launch_context(
    state: State<AppState>,
    task_id: String,
    agent_kind: Option<String>,
    profile_id: Option<String>,
    manual_note: Option<String>,
    event_limit: Option<usize>,
    skill_limit: Option<usize>,
    include_guard: Option<bool>,
    include_skills: Option<bool>,
    include_handover: Option<bool>,
    token_budget: Option<u64>,
) -> AelResult<AgentStartupContext> {
    build_agent_startup_context(
        state,
        task_id,
        agent_kind,
        profile_id,
        manual_note,
        event_limit,
        skill_limit,
        include_guard,
        include_skills,
        include_handover,
        token_budget,
    )
}

#[tauri::command]
pub fn send_agent_input(
    app: AppHandle,
    state: State<AppState>,
    session_id: String,
    text: String,
) -> AelResult<()> {
    if state.acp.contains(&session_id) {
        return state.acp.send_input(&app, &state.db, &session_id, text);
    }
    state
        .agents
        .send_input(&state.db, &app, &state.gate, &session_id, text)
}

#[tauri::command]
pub fn resize_agent_terminal(
    state: State<AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> AelResult<()> {
    if state.acp.contains(&session_id) {
        return Ok(());
    }
    state.agents.resize_session(&session_id, cols, rows)
}

#[tauri::command]
pub fn stop_agent_session(
    app: AppHandle,
    state: State<AppState>,
    session_id: String,
    kill_tree: Option<bool>,
) -> AelResult<AgentSession> {
    if state.acp.contains(&session_id) {
        return state.acp.stop_session(&app, &state.db, &session_id);
    }
    state
        .agents
        .stop_session(&state.db, &app, &session_id, kill_tree.unwrap_or(true))
}

#[tauri::command]
pub fn list_agent_sessions(
    state: State<AppState>,
    task_id: Option<String>,
    status: Option<String>,
) -> AelResult<Vec<AgentSession>> {
    state.agents.list_sessions(&state.db, task_id, status)
}

#[tauri::command]
pub async fn get_agent_snapshot(app: AppHandle, session_id: String) -> AelResult<AgentSnapshot> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let reader = state.db.terminal_reader()?;
        state.agents.snapshot(&reader, &session_id)
    })
    .await
    .map_err(|_| AelError::internal("会话回放读取线程异常结束。"))?
}

#[tauri::command]
pub async fn list_terminal_chunks(
    app: AppHandle,
    session_id: String,
    after_seq: Option<u64>,
) -> AelResult<Vec<TerminalChunk>> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let reader = state.db.terminal_reader()?;
        state.agents.list_chunks(&reader, &session_id, after_seq)
    })
    .await
    .map_err(|_| AelError::internal("会话片段读取线程异常结束。"))?
}

#[tauri::command]
pub fn list_workspace_locks(state: State<AppState>) -> AelResult<Vec<WorkspaceLock>> {
    state.db.list_workspace_locks()
}

#[tauri::command]
pub fn release_workspace_locks_for_session(
    state: State<AppState>,
    session_id: String,
) -> AelResult<usize> {
    state.db.release_workspace_locks_for_session(&session_id)
}

#[tauri::command]
pub fn list_agent_config_targets(cwd: Option<String>) -> AelResult<Vec<AgentConfigTarget>> {
    list_config_targets(cwd)
}

#[tauri::command]
pub fn read_agent_config_target(
    target_id: String,
    cwd: Option<String>,
) -> AelResult<AgentConfigContent> {
    read_config_target(&target_id, cwd)
}

#[tauri::command]
pub fn write_agent_config_target(
    state: State<AppState>,
    target_id: String,
    cwd: Option<String>,
    content: String,
    create_backup: Option<bool>,
) -> AelResult<AgentConfigWriteResult> {
    write_config_target(
        &target_id,
        cwd,
        content,
        create_backup.unwrap_or(true),
        &state.db.paths.backups,
    )
}

#[tauri::command]
pub fn backup_agent_config_target(
    state: State<AppState>,
    target_id: String,
    cwd: Option<String>,
) -> AelResult<Option<String>> {
    backup_config_target(&target_id, cwd, &state.db.paths.backups)
}

/// 会话 token 用量(按真实 transcript / agent 自报,前端只展示)。
#[tauri::command]
pub fn get_session_token_usage(
    state: State<AppState>,
    session_id: String,
) -> AelResult<SessionTokenUsage> {
    session_token_usage(&state.db, &session_id)
}

/// 压缩上下文。summary/budget 走规则压缩;handover 用接手 Prompt。
#[tauri::command]
pub fn compress_context(
    state: State<AppState>,
    session_id: Option<String>,
    text: Option<String>,
    mode: String,
    token_budget: Option<u64>,
) -> AelResult<CompressResult> {
    let m = CompressMode::parse(&mode)?;

    if m == CompressMode::Handover {
        let sid =
            session_id.ok_or_else(|| AelError::invalid_input("handover 压缩需要 sessionId"))?;
        let session = state.db.get_agent_session(&sid)?;
        let before_text = transcript_text(&state.db, &sid)?;
        let settings = state.settings_snapshot();
        let compressed = crate::engine::handover::generate_handover_prompt(
            &state.db,
            &session.task_id,
            &settings,
        )?;
        return Ok(CompressResult {
            tokens_before: estimate_tokens(&before_text),
            tokens_after: estimate_tokens(&compressed),
            compressed,
        });
    }

    let input = match text {
        Some(t) => t,
        None => {
            let sid =
                session_id.ok_or_else(|| AelError::invalid_input("压缩需要 text 或 sessionId"))?;
            transcript_text(&state.db, &sid)?
        }
    };
    Ok(compress_text(&input, m, token_budget))
}
