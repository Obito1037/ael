//! ★ Codex 地盘 —— handover manifest 序列化结构。
//! 严格对齐 contracts/handover-schema.json(snake_case 键,顶层 additionalProperties:false)。
//! 改字段必须 bump `schema_version`。

use crate::models::{Task, TaskEvent};
use serde::{Deserialize, Serialize};

pub const HANDOVER_SCHEMA_VERSION: i64 = 1;
/// AHP(Agent Handover Protocol)开放标准版本 —— 接手方可扩展到「下一代模型」。
pub const AHP_VERSION: &str = "1.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    pub schema_version: i64,
    /// v2:AHP 公开规范版本(缺省视为 v0 老包,兼容导入)。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ahp_version: Option<String>,
    pub generated_at: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub generated_by: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub ael_version: Option<String>,
    /// v2:经验/责任产地(接手方据此判断保鲜期)。
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub origin: Option<ManifestOrigin>,
    pub task: ManifestTask,
    pub events: Vec<ManifestEvent>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub relevant_skills: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub relevant_failures: Vec<serde_json::Value>,
    /// v2:随包携带的治理产物(相对 zip 内路径 / 内联)。
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub adrs: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub policy_decisions: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub brief_path: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub open_questions: Vec<String>,
    pub handover_prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestOrigin {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestTask {
    pub id: String,
    pub title: String,
    pub goal: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub agent_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub repo_state: Option<RepoState>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoState {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub branch: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub commit: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEvent {
    pub seq: i64,
    pub kind: String,
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub evidence_ref: Option<String>,
}

impl ManifestTask {
    pub fn from_task(t: &Task) -> Self {
        let repo_state =
            if t.repo_path.is_some() || t.repo_branch.is_some() || t.repo_commit.is_some() {
                Some(RepoState {
                    path: t.repo_path.clone(),
                    branch: t.repo_branch.clone(),
                    commit: t.repo_commit.clone(),
                })
            } else {
                None
            };
        ManifestTask {
            id: t.id.clone(),
            title: t.title.clone(),
            goal: t.goal.clone(),
            status: t.status.as_str().to_string(),
            agent_id: t.agent_id.clone(),
            tags: t.tags.clone(),
            repo_state,
        }
    }
}

impl ManifestEvent {
    pub fn from_event(e: &TaskEvent) -> Self {
        ManifestEvent {
            seq: e.seq,
            kind: e.kind.as_str().to_string(),
            summary: e.summary.clone(),
            detail: e.detail.clone(),
            evidence_ref: e.evidence_ref.clone(),
        }
    }
}
