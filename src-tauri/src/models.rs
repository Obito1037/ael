//! 领域类型 · 与 contracts/ipc-commands.md 的 TS 类型逐字段对齐。
//! 全部 `#[serde(rename_all = "camelCase")]`,枚举用 snake_case(对齐 TS 字符串字面量)。
//! SQL 列 `trigger_text` ↔ 本处字段 `trigger`(转换在 db 层完成)。
//!
//! v2(治理层)新增:EventActor / 行级锚点、经验保鲜期、海关裁决、
//! Review Brief、ADR、Commit 溯源、Agent 路由推荐。

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

// 证据责任方:AI 提议 / 人工确认 / Guard·海关强制 / 系统。
str_enum!(EventActor {
    Ai => "ai",
    Human => "human",
    Guard => "guard",
    System => "system",
});

// 经验保鲜期:模型换代后自动降级「待重验」。
str_enum!(Freshness {
    Fresh => "fresh",
    NeedsRevalidation => "needs_revalidation",
});

// 海关处置(策略规定)与结局(实际发生)。
str_enum!(PolicyAction {
    Allow => "allow",
    Warn => "warn",
    Hold => "hold",
    Deny => "deny",
});

str_enum!(PolicyVerdictKind {
    Passed => "passed",
    Warned => "warned",
    Approved => "approved",
    Denied => "denied",
    AutoDenied => "auto_denied",
});

str_enum!(DecidedBy {
    Policy => "policy",
    Human => "human",
});

str_enum!(AdrStatus {
    Proposed => "proposed",
    Accepted => "accepted",
    Superseded => "superseded",
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
    /// v2:责任方(默认 ai)。
    pub actor: EventActor,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anchor_lines: Option<String>,
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
    /// v2:产生经验时的 Agent 与模型版本(保鲜期依据)。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_model: Option<String>,
    pub freshness: Freshness,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revalidated_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillExportResult {
    pub path: String,
    pub published_by_cli: bool,
    pub message: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_agent: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_model: Option<String>,
}

// ── 治理层记录(v2)────────────────────────────────────────────

/// 海关账本:每一次裁决(自动或人工)都是一条不可变记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyDecision {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub rule_id: String,
    pub action: PolicyAction,
    pub verdict: PolicyVerdictKind,
    pub command_text: String,
    pub reason: String,
    pub decided_by: DecidedBy,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolved_at: Option<String>,
}

/// 扣在裁决线上待人工处置的命令(内存态,不落库;结局落 policy_decisions)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingCommand {
    pub id: String,
    pub session_id: String,
    pub task_id: String,
    pub command_text: String,
    pub rule_id: String,
    pub reason: String,
    pub created_at: String,
    pub timeout_secs: u64,
    /// ACP 原生权限请求可选项；普通 PTY 海关扣留为空。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub permission_options: Vec<PermissionOptionView>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOptionView {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

/// 策略引擎对一条命令的判定(还未落账本)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyVerdict {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rule_id: Option<String>,
    pub action: PolicyAction,
    pub reason: String,
    pub matched: bool,
}

/// 会话 Token 预算状态(熔断器)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BudgetStatus {
    pub enabled: bool,
    pub max_session_tokens: u64,
    pub used_tokens: u64,
    pub ratio: f64,
    pub breaker_tripped: bool,
}

/// 活文档:decision 事件编译成的架构决策记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdrRecord {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    pub number: i64,
    pub title: String,
    pub status: AdrStatus,
    pub context: String,
    pub decision: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub consequences: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_event_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    pub created_at: String,
}

/// Agent Blame:commit ↔ task 的溯源链接。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitLink {
    pub id: String,
    pub task_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    pub repo_path: String,
    pub commit_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub committed_at: Option<String>,
    pub created_at: String,
}

/// 会话摘要(Blame 报告里「哪个 Agent / 哪次运行」)。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionSummary {
    pub id: String,
    pub agent_id: String,
    pub command_line: String,
    pub started_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ended_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}

/// 任意一行代码 → 3 秒回放的决策现场。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlameReport {
    pub file: String,
    pub line: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_hash: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_subject: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub commit_author: Option<String>,
    pub linked: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub task: Option<Task>,
    pub sessions: Vec<AgentSessionSummary>,
    pub decisions: Vec<TaskEvent>,
    pub human_confirmations: Vec<TaskEvent>,
    pub guard_events: Vec<TaskEvent>,
    pub adrs: Vec<AdrRecord>,
}

// ── Review Brief(出口 ①)──────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefDecision {
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub actor: EventActor,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefErrorFixed {
    pub error: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signature: Option<String>,
    /// 该签名在失败库的历史出现次数(>1 说明是惯犯)。
    pub recurrences: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefVerification {
    pub summary: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub evidence_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BriefStats {
    pub events: i64,
    pub sessions: i64,
    pub tokens_est: u64,
    pub human_confirmed: i64,
    pub ai_proposed: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_secs: Option<i64>,
}

/// 一页审阅证据:审代码 → 审证据。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewBrief {
    pub task_id: String,
    pub title: String,
    pub goal: String,
    pub status: TaskStatus,
    pub generated_at: String,
    pub decisions: Vec<BriefDecision>,
    pub errors_fixed: Vec<BriefErrorFixed>,
    pub verifications: Vec<BriefVerification>,
    pub interceptions: Vec<PolicyDecision>,
    pub risks: Vec<String>,
    pub stats: BriefStats,
    pub markdown: String,
}

// ── 智能路由(横向机制)────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRecommendation {
    pub agent_kind: String,
    pub score: f64,
    pub success_count: i64,
    pub fail_count: i64,
    pub task_count: i64,
    pub reasons: Vec<String>,
}

// ── 复合返回 ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalizeResult {
    pub task: Task,
    pub draft_skills: Vec<Skill>,
    pub draft_failures: Vec<Failure>,
    /// v2:finalize 即编译器 —— 同一条证据链编译出 Brief / ADR / 经验草案。
    pub brief: ReviewBrief,
    pub adrs: Vec<AdrRecord>,
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
    pub actor: EventActor,
    pub session_id: Option<String>,
    pub anchor_file: Option<String>,
    pub anchor_lines: Option<String>,
}

impl NewEvent {
    /// v1 口径的便捷构造:actor=ai,无锚点。老调用点用它保持不变。
    pub fn basic(
        task_id: impl Into<String>,
        kind: EventKind,
        summary: impl Into<String>,
        detail: Option<String>,
        evidence_ref: Option<String>,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            kind,
            summary: summary.into(),
            detail,
            evidence_ref,
            actor: EventActor::Ai,
            session_id: None,
            anchor_file: None,
            anchor_lines: None,
        }
    }
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
    pub origin_agent: Option<String>,
    pub origin_model: Option<String>,
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
    pub origin_agent: Option<String>,
    pub origin_model: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewPolicyDecision {
    pub session_id: Option<String>,
    pub task_id: Option<String>,
    pub rule_id: String,
    pub action: PolicyAction,
    pub verdict: PolicyVerdictKind,
    pub command_text: String,
    pub reason: String,
    pub decided_by: DecidedBy,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewAdr {
    pub task_id: Option<String>,
    pub title: String,
    pub status: AdrStatus,
    pub context: String,
    pub decision: String,
    pub consequences: Option<String>,
    pub source_event_id: Option<String>,
    pub file_path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct NewCommitLink {
    pub task_id: String,
    pub session_id: Option<String>,
    pub repo_path: String,
    pub commit_hash: String,
    pub subject: Option<String>,
    pub author: Option<String>,
    pub committed_at: Option<String>,
}
