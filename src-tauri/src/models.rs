//! 领域类型 · 与 contracts/ipc-commands.md 的 TS 类型逐字段对齐。
//! 全部 `#[serde(rename_all = "camelCase")]`,枚举用 snake_case(对齐 TS 字符串字面量)。
//! SQL 列 `trigger_text` ↔ 本处字段 `trigger`(转换在 db 层完成)。

use crate::error::{AelError, AelResult};
use serde::{Deserialize, Serialize};

// ── 枚举 ───────────────────────────────────────────────────────

macro_rules! str_enum {
    ($name:ident { $($variant:ident => $s:literal),+ $(,)? }) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name {
            $($variant),+
        }
        impl $name {
            pub fn as_str(&self) -> &'static str {
                match self { $(Self::$variant => $s),+ }
            }
            pub fn from_db(s: &str) -> AelResult<Self> {
                match s {
                    $($s => Ok(Self::$variant),)+
                    other => Err(AelError::internal(format!(
                        "非法 {} 取值: {}", stringify!($name), other))),
                }
            }
        }
    };
}

str_enum!(TaskStatus {
    Pending => "pending",
    InProgress => "in_progress",
    Blocked => "blocked",
    Verified => "verified",
    Failed => "failed",
    Abandoned => "abandoned",
});

str_enum!(EventKind {
    Step => "step",
    Error => "error",
    Fix => "fix",
    Verification => "verification",
    Decision => "decision",
    Note => "note",
});

str_enum!(SkillStatus {
    Draft => "draft",
    Active => "active",
    Deprecated => "deprecated",
});

str_enum!(Outcome {
    Helped => "helped",
    Neutral => "neutral",
    Harmful => "harmful",
});

// ── 主记录 ─────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub status: TaskStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo_commit: Option<String>,
    pub tags: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub closed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskEvent {
    pub id: String,
    pub task_id: String,
    pub seq: i64,
    pub kind: EventKind,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_ref: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Skill {
    pub id: String,
    pub name: String,
    /// SQL 列名 trigger_text。
    pub trigger: String,
    pub body: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_task_id: Option<String>,
    pub status: SkillStatus,
    pub version: i64,
    pub success_count: i64,
    pub fail_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub id: String,
    pub signature: String,
    pub description: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root_cause: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
    pub guard_rule: String,
    pub tags: Vec<String>,
    pub occurrences: i64,
}

// ── 复合返回 ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeResult {
    pub task: Task,
    pub draft_skills: Vec<Skill>,
    pub draft_failures: Vec<Failure>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedSkill {
    pub skill: Skill,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuardResult {
    pub matched_failures: Vec<Failure>,
    pub suggested_skills: Vec<Skill>,
    pub constraints: Vec<String>,
    pub handover_prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub data_dir: String,
    pub max_backups: u32,
    pub retrieval_mode: RetrievalMode,
    pub guard_min_score: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RetrievalMode {
    Keyword,
    Hybrid,
}

/// export_handover 的可选包含项,默认全选(见 ipc-commands.md)。
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandoverInclude {
    pub events: Option<bool>,
    pub skills: Option<bool>,
    pub failures: Option<bool>,
    pub open_questions: Option<Vec<String>>,
}

// ── 输入参数（db 层 create/append 用）─────────────────────────

#[derive(Debug, Clone)]
pub struct NewTask {
    pub title: String,
    pub goal: String,
    pub agent_id: Option<String>,
    pub repo_path: Option<String>,
    pub repo_branch: Option<String>,
    pub repo_commit: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct NewEvent {
    pub task_id: String,
    pub kind: EventKind,
    pub summary: String,
    pub detail: Option<String>,
    pub evidence_ref: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewSkill {
    pub name: String,
    pub trigger: String,
    pub body: String,
    pub tags: Vec<String>,
    pub source_task_id: Option<String>,
    /// finalize 产出的草案为 draft;create_skill 命令也默认 draft。
    pub status: SkillStatus,
}

#[derive(Debug, Clone, Default)]
pub struct SkillPatch {
    pub name: Option<String>,
    pub trigger: Option<String>,
    pub body: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Clone)]
pub struct NewFailure {
    pub task_id: Option<String>,
    pub source_event_id: Option<String>,
    pub signature: String,
    pub normalized_text: String,
    pub description: String,
    pub root_cause: Option<String>,
    pub fix: Option<String>,
    pub guard_rule: String,
    pub tags: Vec<String>,
}
