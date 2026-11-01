//! AEL 后端库入口。声明模块、装配 Tauri App、注册全部 IPC 命令。
//!
//! 地盘划分(见 scaffold/PROJECT-LAYOUT.md):
//! - commands / engine ····· Claude Code
//! - db / adapter / handover  Codex(本仓内含可运行的参考实现,签名即契约)

// Tauri 命令的参数就是 IPC 契约字段，拆成结构体会改变前端调用方式。
#![allow(clippy::too_many_arguments)]

pub mod acp;
pub mod adapter;
pub mod agent;
pub mod commands;
pub mod db;
pub mod engine;
pub mod error;
pub mod handover;
pub mod history;
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
            commands::skill::export_skill,
            // 检索 + Failure Guard
            commands::search::search_skills,
            commands::failure::list_failures,
            commands::failure::get_failure,
            commands::failure::check_failure_guard,
            // 接手包
            commands::handover::export_handover,
            commands::handover::import_handover,
            commands::handover::generate_handover_prompt,
            // 本机历史索引(只读扫描，不修改源文件)
            commands::history::scan_history,
            commands::history::get_history_scan_summary,
            commands::history::list_history_conversations,
            commands::history::get_history_conversation,
            commands::history::list_history_messages,
            // 候选经验：提炼后仍需人工审阅
            commands::candidates::extract_history_candidates,
            commands::candidates::distill_history_candidates,
            commands::candidates::list_skill_candidates,
            commands::candidates::list_failure_candidates,
            commands::candidates::update_skill_candidate_status,
            commands::candidates::update_failure_candidate_status,
            commands::candidates::promote_skill_candidate,
            commands::candidates::promote_failure_candidate,
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
            // Provider / MCP 配置兼容层
            commands::provider::list_providers,
            commands::provider::save_provider,
            commands::provider::test_provider,
            commands::provider::list_mcp_servers,
            commands::provider::save_mcp_server,
            // ── v2 治理层 ──────────────────────────────────────
            // 出口③ 运行时海关
            commands::policy::gate_list_pending,
            commands::policy::gate_resolve_pending,
            commands::policy::gate_list_decisions,
            commands::policy::gate_get_policy_text,
            commands::policy::gate_set_policy_text,
            commands::policy::gate_test_command,
            commands::policy::gate_get_budget,
            // 出口① Review Brief
            commands::brief::compile_brief,
            commands::brief::export_brief,
            // 出口④ 活文档 ADR
            commands::adr::list_adrs,
            commands::adr::compile_adrs,
            commands::adr::export_adrs,
            // 出口② Agent Blame
            commands::blame::generate_commit_trailer,
            commands::blame::record_commit_link,
            commands::blame::list_commit_links,
            commands::blame::scan_repo_commits,
            commands::blame::blame_line,
            // 横向:智能路由 + 经验保鲜期
            commands::route::recommend_agents,
            commands::route::run_freshness_check,
            commands::route::revalidate_skill,
        ])
        .run(tauri::generate_context!())
        .expect("启动 AEL Tauri 应用失败");
}
