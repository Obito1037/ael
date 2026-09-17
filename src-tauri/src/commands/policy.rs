//! 运行时海关 IPC(出口③)。待裁决队列 / 裁决账本 / 策略文件 / 命令试判 / 预算。

use crate::db::init;
use crate::error::AelResult;
use crate::models::{BudgetStatus, PendingCommand, PolicyDecision, PolicyVerdict};
use crate::state::AppState;
use tauri::{AppHandle, State};

/// 当前所有扣在裁决线上的命令。
#[tauri::command]
pub fn gate_list_pending(state: State<AppState>) -> AelResult<Vec<PendingCommand>> {
    let mut pending = state.agents.list_pending();
    pending.extend(state.acp.list_pending_permissions());
    Ok(pending)
}

/// 人工放行 / 拦截一条待裁决命令。
#[tauri::command]
pub fn gate_resolve_pending(
    app: AppHandle,
    state: State<AppState>,
    pending_id: String,
    approve: bool,
) -> AelResult<PolicyDecision> {
    if state
        .acp
        .list_pending_permissions()
        .iter()
        .any(|pending| pending.id == pending_id)
    {
        state
            .acp
            .resolve_permission(&state.db, &app, &pending_id, approve)
    } else {
        state
            .agents
            .resolve_pending(&state.db, &app, &pending_id, approve)
    }
}

/// 海关账本查询(按会话或任务过滤,时间倒序)。
#[tauri::command]
pub fn gate_list_decisions(
    state: State<AppState>,
    task_id: Option<String>,
    session_id: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> AelResult<Vec<PolicyDecision>> {
    state.db.list_policy_decisions(
        session_id.as_deref(),
        task_id.as_deref(),
        limit.unwrap_or(100),
        offset.unwrap_or(0),
    )
}

/// 读取 policy.toml 原文。
#[tauri::command]
pub fn gate_get_policy_text(state: State<AppState>) -> AelResult<String> {
    Ok(state.gate.raw_text())
}

/// 校验并热更新 policy.toml(编译失败则拒绝写入,保留旧策略)。
#[tauri::command]
pub fn gate_set_policy_text(state: State<AppState>, text: String) -> AelResult<()> {
    state.gate.replace(&text)?; // 编译失败在这里返回错误,不写盘
    init::save_policy_text(&state.db.paths, &text)?;
    Ok(())
}

/// 命令试判(UI 演示 / 编辑策略时预览命中)。
#[tauri::command]
pub fn gate_test_command(state: State<AppState>, command_text: String) -> AelResult<PolicyVerdict> {
    Ok(state.gate.evaluate(&command_text))
}

/// 会话预算状态(熔断器)。
#[tauri::command]
pub fn gate_get_budget(state: State<AppState>, session_id: String) -> AelResult<BudgetStatus> {
    state
        .agents
        .budget_status(&state.db, &state.gate, &session_id)
}
