//! Provider / MCP server 配置命令。
//! 前端 src/lib/ipc.ts 已在调用这些命令;本模块把它们接到 db 层。
//! 入参 camelCase 由 Tauri 自动映射到 snake_case 函数参数。

use crate::db::{McpServerConfig, ProviderConfig};
use crate::error::{AelError, AelResult};
use crate::state::AppState;
use serde::Serialize;
use std::time::Duration;
use tauri::State;

#[tauri::command]
pub fn list_providers(state: State<AppState>) -> AelResult<Vec<ProviderConfig>> {
    state.db.list_providers()
}

#[tauri::command]
pub fn save_provider(state: State<AppState>, provider: ProviderConfig) -> AelResult<()> {
    state.db.upsert_provider(&provider)?;
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestProviderResult {
    pub success: bool,
    pub message: String,
}

/// 连通性测试:对 provider 的 endpoint 打 `/v1/models`(OpenAI 兼容)。
#[tauri::command]
pub fn test_provider(state: State<AppState>, provider_id: String) -> AelResult<TestProviderResult> {
    let provider = state
        .db
        .get_provider(&provider_id)?
        .ok_or_else(|| AelError::not_found(format!("provider {provider_id} 不存在")))?;
    Ok(probe_provider(&provider))
}

#[tauri::command]
pub fn list_mcp_servers(state: State<AppState>) -> AelResult<Vec<McpServerConfig>> {
    state.db.list_mcp_servers()
}

#[tauri::command]
pub fn save_mcp_server(state: State<AppState>, server: McpServerConfig) -> AelResult<()> {
    state.db.upsert_mcp_server(&server)?;
    Ok(())
}

/// 用 ureq 发一个 GET /v1/models,2xx 视为连通。错误不抛 AelError,
/// 而是作为 { success:false, message } 返回,让前端按结果展示。
fn probe_provider(p: &ProviderConfig) -> TestProviderResult {
    let base = p.endpoint.trim().trim_end_matches('/');
    if base.is_empty() {
        return TestProviderResult {
            success: false,
            message: "未配置 endpoint".into(),
        };
    }
    let url = if base.ends_with("/v1") {
        format!("{base}/models")
    } else {
        format!("{base}/v1/models")
    };

    let mut req = ureq::get(&url).timeout(Duration::from_secs(10));
    if !p.api_key.is_empty() {
        req = req.set("Authorization", &format!("Bearer {}", p.api_key));
    }

    match req.call() {
        Ok(resp) => TestProviderResult {
            success: true,
            message: format!("连通成功 (HTTP {}):{}", resp.status(), url),
        },
        Err(ureq::Error::Status(code, _)) => TestProviderResult {
            success: false,
            message: format!("鉴权/端点返回 HTTP {code}:{url}(检查 API Key 与 endpoint)"),
        },
        Err(e) => TestProviderResult {
            success: false,
            message: format!("请求失败:{e}"),
        },
    }
}
