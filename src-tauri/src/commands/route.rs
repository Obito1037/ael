//! 智能路由 + 经验保鲜期 IPC(横向机制)。

use crate::engine::{freshness, route};
use crate::error::AelResult;
use crate::models::{AgentRecommendation, Skill};
use crate::state::AppState;
use serde::Serialize;
use tauri::State;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FreshnessResult {
    pub downgraded: u64,
}

/// 经验驱动的 Agent 推荐(成败账本 + 相似任务可复用经验)。
#[tauri::command]
pub fn recommend_agents(
    state: State<AppState>,
    goal: String,
    tags: Option<Vec<String>>,
) -> AelResult<Vec<AgentRecommendation>> {
    let settings = state.settings_snapshot();
    route::recommend_agents(&state.db, &goal, &tags.unwrap_or_default(), &settings)
}

/// 全库保鲜检查:换代降级 / 计数复活或淘汰。返回本次新降级条数。
#[tauri::command]
pub fn run_freshness_check(
    state: State<AppState>,
    current_model: Option<String>,
) -> AelResult<FreshnessResult> {
    let downgraded = freshness::run_freshness_check(&state.db, current_model.as_deref())?;
    Ok(FreshnessResult { downgraded })
}

/// 人工点「已重验通过」:复活为 fresh 并更新 origin_model。
#[tauri::command]
pub fn revalidate_skill(
    state: State<AppState>,
    skill_id: String,
    current_model: Option<String>,
) -> AelResult<Skill> {
    freshness::revalidate_skill(&state.db, &skill_id, current_model.as_deref())
}
