//! 运行时海关 · 策略引擎(出口③)。
//!
//! 「规则会被模型遗忘,但不会被网关遗忘」—— 裁决发生在模型之外,坐在 Agent 与 Shell 之间。
//! 本模块只负责**判定**(命令行 → PolicyVerdict)与策略文件的加载 / 校验 / 热更新;
//! 扣留队列、写 PTY、落账本在 agent 运行时与 commands 层完成。

use crate::error::{AelError, AelResult};
use crate::models::{PolicyAction, PolicyVerdict};
use regex::Regex;
use serde::Deserialize;
use std::sync::RwLock;

// ── policy.toml 反序列化结构 ────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
pub struct PolicyFile {
    #[serde(default = "default_schema_version")]
    pub schema_version: i64,
    #[serde(default)]
    pub gate: GateSection,
    #[serde(default)]
    pub budget: BudgetSection,
    #[serde(default)]
    pub redaction: RedactionSection,
    #[serde(default, rename = "rules")]
    pub rules: Vec<RuleSection>,
}

fn default_schema_version() -> i64 {
    1
}

#[derive(Debug, Clone, Deserialize)]
pub struct GateSection {
    #[serde(default = "yes")]
    pub apply_to_input: bool,
    #[serde(default = "yes")]
    pub scan_output: bool,
    #[serde(default = "default_hold_timeout")]
    pub hold_timeout_secs: u64,
}

fn yes() -> bool {
    true
}
fn default_hold_timeout() -> u64 {
    120
}

impl Default for GateSection {
    fn default() -> Self {
        Self {
            apply_to_input: true,
            scan_output: true,
            hold_timeout_secs: 120,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct BudgetSection {
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default = "default_max_tokens")]
    pub max_session_tokens: u64,
    #[serde(default = "default_warn_ratio")]
    pub warn_ratio: f64,
}

fn default_max_tokens() -> u64 {
    500_000
}
fn default_warn_ratio() -> f64 {
    0.8
}

impl Default for BudgetSection {
    fn default() -> Self {
        Self {
            enabled: true,
            max_session_tokens: 500_000,
            warn_ratio: 0.8,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct RedactionSection {
    #[serde(default = "yes")]
    pub enabled: bool,
}

impl Default for RedactionSection {
    fn default() -> Self {
        Self { enabled: true }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct RuleSection {
    pub id: String,
    pub action: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub patterns: Vec<String>,
}

// ── 编译后的策略(regex 已编译)────────────────────────────────

#[derive(Clone)]
struct CompiledRule {
    id: String,
    title: String,
    action: PolicyAction,
    patterns: Vec<Regex>,
}

#[derive(Clone)]
pub struct CompiledPolicy {
    pub apply_to_input: bool,
    pub scan_output: bool,
    pub hold_timeout_secs: u64,
    pub budget_enabled: bool,
    pub max_session_tokens: u64,
    pub warn_ratio: f64,
    pub redaction_enabled: bool,
    rules: Vec<CompiledRule>,
    raw_text: String,
}

impl CompiledPolicy {
    /// 用命令行文本对全部规则求值,返回最严处置(deny > hold > warn > allow)。
    pub fn evaluate(&self, command: &str) -> PolicyVerdict {
        let mut best: Option<(&CompiledRule, u8)> = None;
        for rule in &self.rules {
            if rule.patterns.iter().any(|re| re.is_match(command)) {
                let sev = severity(rule.action);
                if best.map(|(_, s)| sev > s).unwrap_or(true) {
                    best = Some((rule, sev));
                }
            }
        }
        match best {
            Some((rule, _)) => PolicyVerdict {
                rule_id: Some(rule.id.clone()),
                action: rule.action,
                reason: rule.title.clone(),
                matched: true,
            },
            None => PolicyVerdict {
                rule_id: None,
                action: PolicyAction::Allow,
                reason: "无命中".into(),
                matched: false,
            },
        }
    }

    pub fn raw_text(&self) -> &str {
        &self.raw_text
    }

    pub fn rule_count(&self) -> usize {
        self.rules.len()
    }
}

fn severity(action: PolicyAction) -> u8 {
    match action {
        PolicyAction::Allow => 0,
        PolicyAction::Warn => 1,
        PolicyAction::Hold => 2,
        PolicyAction::Deny => 3,
    }
}

/// 解析并编译一份 policy.toml 文本。任何 TOML 语法错误 / 非法 action / regex 编译失败都返回 Err。
pub fn compile(text: &str) -> AelResult<CompiledPolicy> {
    let parsed: PolicyFile = toml::from_str(text)
        .map_err(|e| AelError::invalid_input(format!("policy.toml 解析失败: {e}")))?;

    let mut rules = Vec::with_capacity(parsed.rules.len());
    for r in &parsed.rules {
        let action = PolicyAction::from_db(&r.action)
            .map_err(|_| AelError::invalid_input(format!("规则 {} 的 action 非法: {}", r.id, r.action)))?;
        let mut patterns = Vec::with_capacity(r.patterns.len());
        for p in &r.patterns {
            let re = Regex::new(p)
                .map_err(|e| AelError::invalid_input(format!("规则 {} 的正则无效: {e}", r.id)))?;
            patterns.push(re);
        }
        rules.push(CompiledRule {
            id: r.id.clone(),
            title: if r.title.is_empty() {
                r.id.clone()
            } else {
                r.title.clone()
            },
            action,
            patterns,
        });
    }

    Ok(CompiledPolicy {
        apply_to_input: parsed.gate.apply_to_input,
        scan_output: parsed.gate.scan_output,
        hold_timeout_secs: parsed.gate.hold_timeout_secs,
        budget_enabled: parsed.budget.enabled,
        max_session_tokens: parsed.budget.max_session_tokens,
        warn_ratio: parsed.budget.warn_ratio,
        redaction_enabled: parsed.redaction.enabled,
        rules,
        raw_text: text.to_string(),
    })
}

/// 海关网关:线程安全地持有当前编译后的策略,支持热更新。
pub struct PolicyGate {
    policy: RwLock<CompiledPolicy>,
}

impl PolicyGate {
    pub fn new(text: &str) -> AelResult<Self> {
        Ok(Self {
            policy: RwLock::new(compile(text)?),
        })
    }

    /// 读一份当前策略快照(clone,持锁短)。
    pub fn snapshot(&self) -> CompiledPolicy {
        self.policy.read().expect("policy gate poisoned").clone()
    }

    pub fn evaluate(&self, command: &str) -> PolicyVerdict {
        self.policy
            .read()
            .expect("policy gate poisoned")
            .evaluate(command)
    }

    pub fn raw_text(&self) -> String {
        self.policy
            .read()
            .expect("policy gate poisoned")
            .raw_text()
            .to_string()
    }

    /// 轻量读取(避免逐块 clone 整份编译策略):脱敏开关。
    pub fn redaction_enabled(&self) -> bool {
        self.policy.read().expect("policy gate poisoned").redaction_enabled
    }

    /// 轻量读取:是否对输入逐行裁决。
    pub fn apply_to_input(&self) -> bool {
        self.policy.read().expect("policy gate poisoned").apply_to_input
    }

    /// 轻量读取:扣留超时秒数。
    pub fn hold_timeout_secs(&self) -> u64 {
        self.policy.read().expect("policy gate poisoned").hold_timeout_secs
    }

    /// 轻量读取:预算熔断参数 (enabled, max_tokens, warn_ratio)。
    pub fn budget_params(&self) -> (bool, u64, f64) {
        let p = self.policy.read().expect("policy gate poisoned");
        (p.budget_enabled, p.max_session_tokens, p.warn_ratio)
    }

    /// 校验新文本 → 编译成功才热替换。失败时保留旧策略并返回错误。
    pub fn replace(&self, text: &str) -> AelResult<()> {
        let compiled = compile(text)?;
        *self.policy.write().expect("policy gate poisoned") = compiled;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"
schema_version = 1
[gate]
apply_to_input = true
hold_timeout_secs = 60
[budget]
max_session_tokens = 1000
[[rules]]
id = "destructive_fs"
action = "hold"
title = "破坏性删除"
patterns = ['(?i)\brm\s+-rf\b']
[[rules]]
id = "risky_git"
action = "warn"
patterns = ['(?i)\bgit\s+push\b.*--force']
"#;

    #[test]
    fn compiles_and_reads_sections() {
        let p = compile(SAMPLE).unwrap();
        assert_eq!(p.hold_timeout_secs, 60);
        assert_eq!(p.max_session_tokens, 1000);
        assert_eq!(p.rule_count(), 2);
    }

    #[test]
    fn evaluates_most_severe() {
        let p = compile(SAMPLE).unwrap();
        let v = p.evaluate("rm -rf / && git push --force");
        assert_eq!(v.action, PolicyAction::Hold); // hold 比 warn 严
        assert_eq!(v.rule_id.as_deref(), Some("destructive_fs"));
        assert!(p.evaluate("ls -la").action == PolicyAction::Allow);
    }

    #[test]
    fn rejects_bad_regex() {
        let bad = "[[rules]]\nid=\"x\"\naction=\"deny\"\npatterns=['(unterminated']\n";
        assert!(compile(bad).is_err());
    }
}
