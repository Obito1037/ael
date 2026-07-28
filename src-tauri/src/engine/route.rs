//! 经验驱动智能路由(横向机制):skill_usages 的成败数据 = 本地私有 Agent 评测榜。
//! 新任务自动推荐最擅长的 Agent —— 不是拍脑袋,是让账本说话。

use super::search;
use crate::db::Db;
use crate::error::AelResult;
use crate::models::{AgentRecommendation, Settings};

const REL_LIMIT: i64 = 12;

/// 结合「历史成败(所有任务)」+「相似任务上的可复用经验数」给 Agent 打分排序。
pub fn recommend_agents(
    db: &Db,
    goal: &str,
    tags: &[String],
    settings: &Settings,
) -> AelResult<Vec<AgentRecommendation>> {
    // (agent_kind, task_count, success_sum, fail_sum)
    let records = db.agent_track_records()?;

    // 相似任务上,每个 origin_agent 贡献了多少条可复用 Skill。
    let relevant = search::suggested_skills(db, goal, tags, REL_LIMIT, settings.guard_min_score)?;
    let mut rel_by_agent: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for s in &relevant {
        if let Some(agent) = &s.origin_agent {
            *rel_by_agent.entry(agent.clone()).or_insert(0) += 1;
        }
    }

    let mut recs: Vec<AgentRecommendation> = records
        .into_iter()
        .filter(|(kind, ..)| !kind.trim().is_empty())
        .map(|(kind, task_count, success, fail)| {
            let rel = rel_by_agent.get(&kind).copied().unwrap_or(0);
            // Laplace 平滑成功率 ∈ (0,1),避免小样本极端;再叠加相关经验加成。
            let win_rate = (success as f64 + 1.0) / (success as f64 + fail as f64 + 2.0);
            let volume = ((task_count.max(0) as f64) + 1.0).ln();
            let rel_bonus = (rel as f64) * 0.15;
            let score = win_rate * (1.0 + 0.2 * volume) + rel_bonus;

            let mut reasons = Vec::new();
            reasons.push(format!(
                "历史成败 {}/{}(平滑胜率 {:.0}%)",
                success,
                fail,
                win_rate * 100.0
            ));
            if task_count > 0 {
                reasons.push(format!("覆盖 {task_count} 个不同任务"));
            }
            if rel > 0 {
                reasons.push(format!("在相似任务上有 {rel} 条可复用经验"));
            }

            AgentRecommendation {
                agent_kind: kind,
                score,
                success_count: success,
                fail_count: fail,
                task_count,
                reasons,
            }
        })
        .collect();

    recs.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    Ok(recs)
}
