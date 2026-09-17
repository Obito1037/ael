//! 经验保鲜期(横向机制):每条 Skill 绑定产生时的模型/工具版本。
//! 检测到模型换代 → 自动降级「待重验」;由后续成败计数决定复活或淘汰。
//! 把「AI 发展太快」从威胁变成独有功能:旧经验不会静默腐坏,会被显式标记待验证。

use crate::db::Db;
use crate::error::AelResult;
use crate::models::{Freshness, Outcome, Skill, SkillStatus};

const RECENT_WINDOW: i64 = 5;

/// 全库保鲜检查。返回本次「新降级为待重验」的条数。
///
/// - fresh 且 origin_model 与当前模型不同 → 降级 needs_revalidation。
/// - needs_revalidation 且近期复用多为 helped → 复活为 fresh(并把 origin_model 刷成当前)。
/// - needs_revalidation 且近期复用出现 harmful 且无 helped → 淘汰为 deprecated。
pub fn run_freshness_check(db: &Db, current_model: Option<&str>) -> AelResult<u64> {
    let skills = db.list_skills(None, 100_000, 0)?;
    let mut downgraded = 0u64;

    for skill in skills {
        match skill.freshness {
            Freshness::Fresh => {
                if let (Some(origin), Some(current)) =
                    (skill.origin_model.as_deref(), current_model)
                {
                    if !origin.is_empty() && origin != current {
                        db.set_skill_freshness(&skill.id, Freshness::NeedsRevalidation, None)?;
                        downgraded += 1;
                    }
                }
            }
            Freshness::NeedsRevalidation => {
                revalidate_by_counts(db, &skill, current_model)?;
            }
        }
    }
    Ok(downgraded)
}

/// 人工点「已重验通过」:直接复活为 fresh,并把 origin_model 更新为当前模型。
pub fn revalidate_skill(db: &Db, skill_id: &str, current_model: Option<&str>) -> AelResult<Skill> {
    db.set_skill_freshness(skill_id, Freshness::Fresh, current_model)
}

fn revalidate_by_counts(db: &Db, skill: &Skill, current_model: Option<&str>) -> AelResult<()> {
    let recent = db.recent_skill_outcomes(&skill.id, RECENT_WINDOW)?;
    if recent.is_empty() {
        return Ok(());
    }
    let helped = recent.iter().filter(|o| **o == Outcome::Helped).count();
    let harmful = recent.iter().filter(|o| **o == Outcome::Harmful).count();

    if helped >= 2 && harmful == 0 {
        // 换代后仍然稳定有效 → 复活。
        db.set_skill_freshness(&skill.id, Freshness::Fresh, current_model)?;
    } else if harmful >= 1 && helped == 0 && skill.status != SkillStatus::Deprecated {
        // 换代后开始帮倒忙 → 淘汰。
        db.update_skill_status(&skill.id, SkillStatus::Deprecated)?;
    }
    Ok(())
}
