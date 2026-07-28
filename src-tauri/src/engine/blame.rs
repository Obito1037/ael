//! Agent Blame(出口②):行级代码溯源账本。
//!
//! git blame 只能追到「人」;AEL 把 task_id 写进 commit trailer + 证据链按行锚定,
//! 让任意一行 AI 代码 → 3 秒回放决策现场(哪次任务 / 哪个 Agent / 基于哪条决策 / 谁确认)。

use crate::db::Db;
use crate::error::{AelError, AelResult};
use crate::models::{
    AgentSessionSummary, BlameReport, CommitLink, EventActor, EventKind, NewCommitLink, TaskEvent,
};
use std::process::Command;

const TRAILER_KEY: &str = "AEL-Task:";
const LOG_SCAN_LIMIT: usize = 500;

/// 生成提交时应附带的 trailer 行。Agent 在 commit message 末尾带上它即可溯源。
pub fn commit_trailer(task_id: &str) -> String {
    format!("{TRAILER_KEY} {task_id}")
}

/// 扫描仓库最近提交,把带 `AEL-Task:` trailer 的提交登记到 commit_links。
pub fn scan_repo_commits(db: &Db, repo_path: &str) -> AelResult<Vec<CommitLink>> {
    // 单元分隔:%x1f 分字段,%x1e 分记录。
    let out = run_git(
        repo_path,
        &[
            "log",
            &format!("-n{LOG_SCAN_LIMIT}"),
            "--no-color",
            "--pretty=format:%H%x1f%s%x1f%an%x1f%cI%x1f%b%x1e",
        ],
    )?;
    let mut links = Vec::new();
    for record in out.split('\u{1e}') {
        let record = record.trim_matches(|c| c == '\n' || c == '\r');
        if record.is_empty() {
            continue;
        }
        let fields: Vec<&str> = record.split('\u{1f}').collect();
        if fields.len() < 5 {
            continue;
        }
        let (hash, subject, author, committed, body) =
            (fields[0].trim(), fields[1], fields[2], fields[3], fields[4]);
        let Some(task_id) = parse_trailer(body) else {
            continue;
        };
        // task 必须存在于本地库才登记(外部 trailer 忽略)。
        if db.get_task(&task_id).is_err() {
            continue;
        }
        let link = db.upsert_commit_link(NewCommitLink {
            task_id,
            session_id: None,
            repo_path: repo_path.to_string(),
            commit_hash: hash.to_string(),
            subject: non_empty(subject),
            author: non_empty(author),
            committed_at: non_empty(committed),
        })?;
        links.push(link);
    }
    Ok(links)
}

/// 对一行代码回放决策现场。
pub fn blame_line(db: &Db, repo_path: &str, file: &str, line: u32) -> AelResult<BlameReport> {
    let (commit_hash, subject, author) = git_blame_line(repo_path, file, line)?;

    // 先查本地链接;查不到就增量扫描一次再查。
    let mut link = db.find_commit_link(repo_path, &commit_hash)?;
    if link.is_none() {
        let _ = scan_repo_commits(db, repo_path)?;
        link = db.find_commit_link(repo_path, &commit_hash)?;
    }
    if link.is_none() {
        link = db.find_commit_link_by_hash_prefix(&commit_hash)?;
    }

    let mut report = BlameReport {
        file: file.to_string(),
        line,
        commit_hash: Some(commit_hash),
        commit_subject: subject,
        commit_author: author,
        linked: false,
        task: None,
        sessions: Vec::new(),
        decisions: Vec::new(),
        human_confirmations: Vec::new(),
        guard_events: Vec::new(),
        adrs: Vec::new(),
    };

    let Some(link) = link else {
        return Ok(report); // 未链接:只回 commit 信息
    };

    let task = db.get_task(&link.task_id)?;
    let events = db.list_events(&task.id)?;
    let sessions = db
        .list_agent_sessions(Some(task.id.clone()), None)?
        .into_iter()
        .map(|s| AgentSessionSummary {
            id: s.id,
            agent_id: s.agent_id,
            command_line: s.command_line,
            started_at: s.started_at,
            ended_at: s.ended_at,
            exit_code: s.exit_code,
        })
        .collect();

    // 锚点命中当前文件的事件排前面。
    let mut decisions: Vec<TaskEvent> = events
        .iter()
        .filter(|e| e.kind == EventKind::Decision)
        .cloned()
        .collect();
    sort_anchor_first(&mut decisions, file);
    let human_confirmations = events
        .iter()
        .filter(|e| e.actor == EventActor::Human)
        .cloned()
        .collect();
    let guard_events = events
        .iter()
        .filter(|e| e.actor == EventActor::Guard)
        .cloned()
        .collect();
    let adrs = db.list_adrs(Some(&task.id))?;

    report.linked = true;
    report.task = Some(task);
    report.sessions = sessions;
    report.decisions = decisions;
    report.human_confirmations = human_confirmations;
    report.guard_events = guard_events;
    report.adrs = adrs;
    Ok(report)
}

// ── git 调用 ───────────────────────────────────────────────────

fn git_blame_line(repo_path: &str, file: &str, line: u32) -> AelResult<(String, Option<String>, Option<String>)> {
    let range = format!("{line},{line}");
    let out = run_git(
        repo_path,
        &["blame", "-L", &range, "--porcelain", "--", file],
    )?;
    let mut lines = out.lines();
    let header = lines
        .next()
        .ok_or_else(|| AelError::not_found(format!("git blame 无输出({file}:{line})")))?;
    let commit_hash = header
        .split_whitespace()
        .next()
        .unwrap_or("")
        .to_string();
    if commit_hash.is_empty() {
        return Err(AelError::not_found("git blame 未解析到 commit"));
    }
    let mut author = None;
    let mut subject = None;
    for l in lines {
        if let Some(rest) = l.strip_prefix("author ") {
            author = non_empty(rest);
        } else if let Some(rest) = l.strip_prefix("summary ") {
            subject = non_empty(rest);
        }
    }
    Ok((commit_hash, subject, author))
}

fn run_git(repo_path: &str, args: &[&str]) -> AelResult<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|e| AelError::io_error(format!("git 调用失败(未安装或不在 PATH?): {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AelError::io_error(format!(
            "git {} 失败: {}",
            args.first().copied().unwrap_or(""),
            stderr.trim()
        )));
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ── 解析 / 小工具 ──────────────────────────────────────────────

fn parse_trailer(body: &str) -> Option<String> {
    for line in body.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix(TRAILER_KEY) {
            let id = rest.trim();
            if !id.is_empty() {
                return Some(id.to_string());
            }
        }
    }
    None
}

fn sort_anchor_first(events: &mut [TaskEvent], file: &str) {
    events.sort_by_key(|e| match &e.anchor_file {
        Some(f) if f == file || f.ends_with(file) || file.ends_with(f.as_str()) => 0,
        Some(_) => 1,
        None => 2,
    });
}

fn non_empty(s: &str) -> Option<String> {
    let t = s.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trailer_roundtrip() {
        let t = commit_trailer("T-0417");
        assert_eq!(t, "AEL-Task: T-0417");
        assert_eq!(parse_trailer("fix build\n\nAEL-Task: T-0417\n"), Some("T-0417".into()));
        assert_eq!(parse_trailer("no trailer here"), None);
    }
}
