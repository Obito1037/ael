//! AEL 后端库入口。声明模块、装配 Tauri App、注册全部 IPC 命令。
//!
//! 地盘划分(见 scaffold/PROJECT-LAYOUT.md):
//! - commands / engine ····· Claude Code
//! - db / adapter / handover  Codex(本仓内含可运行的参考实现,签名即契约)

pub mod adapter;
pub mod agent;
pub mod commands;
pub mod db;
pub mod engine;
pub mod error;
pub mod handover;
pub mod models;
pub mod state;
pub mod util;

use state::AppState;

/// 由 main 调用。初始化数据层 → 注入状态 → 注册命令 → 起窗口。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app_state = AppState::bootstrap().expect("AEL 数据层初始化失败");

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // 任务
            commands::task::create_task,
            commands::task::get_task,
            commands::task::list_tasks,
            commands::task::update_task_status,
            commands::task::finalize_task,
            // 证据链
            commands::event::append_event,
            commands::event::list_events,
            // Skill 生命周期
            commands::skill::list_skills,
            commands::skill::get_skill,
            commands::skill::create_skill,
            commands::skill::update_skill,
            commands::skill::update_skill_status,
            commands::skill::record_skill_usage,
            // 检索 + Failure Guard
            commands::search::search_skills,
            commands::failure::list_failures,
            commands::failure::get_failure,
            commands::failure::check_failure_guard,
            // 接手包
            commands::handover::export_handover,
            commands::handover::import_handover,
            commands::handover::generate_handover_prompt,
            // 设置 / 维护
            commands::settings::get_settings,
            commands::settings::set_settings,
            commands::settings::backup_now,
            // Agent Runtime / 终端会话
            commands::agent::detect_agents,
            commands::agent::build_agent_startup_context,
            commands::agent::build_launch_context,
            commands::agent::start_agent_session,
            commands::agent::send_agent_input,
            commands::agent::resize_agent_terminal,
            commands::agent::stop_agent_session,
            commands::agent::list_agent_sessions,
            commands::agent::get_agent_snapshot,
            commands::agent::list_terminal_chunks,
            commands::agent::list_workspace_locks,
            commands::agent::release_workspace_locks_for_session,
            commands::agent::list_agent_config_targets,
            commands::agent::read_agent_config_target,
            commands::agent::write_agent_config_target,
            commands::agent::backup_agent_config_target,
            commands::agent::get_session_token_usage,
            commands::agent::compress_context,
            // Provider / MCP 配置(CC Switch 等价层)
            commands::provider::list_providers,
            commands::provider::save_provider,
            commands::provider::test_provider,
            commands::provider::list_mcp_servers,
            commands::provider::save_mcp_server,
        ])
        .run(tauri::generate_context!())
        .expect("启动 AEL Tauri 应用失败");
}
