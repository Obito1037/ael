//! 检索命令。score 已过 guardMinScore 阈值(见 DECISIONS 决策 1)。

use crate::engine::search;
use crate::error::AelResult;
use crate::models::{RankedSkill, SkillStatus};
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn search_skills(
    state: State<AppState>,
    query: String,
    status: Option<SkillStatus>,
    limit: Option<i64>,
) -> AelResult<Vec<RankedSkill>> {
    let min = state.settings_snapshot().guard_min_score;
    // 默认只检索 active(可被注入的经验);显式传 status 则覆盖。
    let status = status.or(Some(SkillStatus::Active));
    search::ranked_skills(&state.db, &query, status, limit.unwrap_or(20), min)
}
