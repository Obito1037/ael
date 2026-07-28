//! 活文档(出口④):decision 事件 → 架构决策记录(ADR)。
//!
//! vibe coding 烂摊子的根因不是代码差,是 **why 全部丢失**。
//! 代码被生产的同时,把「为什么」同步固化成 ADR;可写盘到仓库 adr/NNNN-*.md。

use crate::db::Db;
use crate::error::AelResult;
use crate::models::{AdrRecord, AdrStatus, EventKind, NewAdr, TaskEvent};
use std::path::Path;

/// 把某任务里尚未编译的 decision 事件编译成 ADR(幂等:source_event_id 去重)。
pub fn compile(db: &Db, task_id: &str) -> AelResult<Vec<AdrRecord>> {
    let task = db.get_task(task_id)?;
    let events = db.list_events(task_id)?;
    let mut out = Vec::new();
    for ev in events.iter().filter(|e| e.kind == EventKind::Decision) {
        if let Some(existing) = db.find_adr_by_source_event(&ev.id)? {
            out.push(existing);
            continue;
        }
        let new = NewAdr {
            task_id: Some(task.id.clone()),
            title: title_from(&ev.summary),
            status: AdrStatus::Accepted,
            context: format!("任务目标:{}", task.goal.trim()),
            decision: decision_body(ev),
            consequences: ev.detail.clone().filter(|d| !d.trim().is_empty()),
            source_event_id: Some(ev.id.clone()),
            file_path: None,
        };
        out.push(db.insert_adr(new)?);
    }
    Ok(out)
}

/// 导出为仓库内 adr/NNNN-slug.md 文件,回写 file_path,并返回写出的路径。
pub fn export(db: &Db, task_id: &str, repo_path: Option<&str>) -> AelResult<Vec<String>> {
    let adrs = compile(db, task_id)?;
    // 目标目录:显式 repo_path/adr,否则 ~/.ael/... 下不写(交由前端选择)。
    let base = match repo_path {
        Some(p) => Path::new(p).join("adr"),
        None => db.paths.root.join("adr"),
    };
    std::fs::create_dir_all(&base)?;
    let mut written = Vec::new();
    for adr in &adrs {
        let fname = format!("{:04}-{}.md", adr.number, slug(&adr.title));
        let path = base.join(&fname);
        std::fs::write(&path, render_markdown(adr))?;
        let path_str = path.to_string_lossy().to_string();
        db.set_adr_file_path(&adr.id, &path_str)?;
        written.push(path_str);
    }
    Ok(written)
}

/// 单条 ADR 的 markdown。
pub fn render_markdown(adr: &AdrRecord) -> String {
    let mut m = String::new();
    m.push_str(&format!("# ADR-{:04}: {}\n\n", adr.number, adr.title));
    m.push_str(&format!("- 状态: {}\n", adr.status.as_str()));
    m.push_str(&format!("- 日期: {}\n", adr.created_at));
    if let Some(tid) = &adr.task_id {
        m.push_str(&format!("- 来源任务: {tid}\n"));
    }
    m.push_str("\n## 背景\n");
    m.push_str(adr.context.trim());
    m.push_str("\n\n## 决策\n");
    m.push_str(adr.decision.trim());
    if let Some(c) = &adr.consequences {
        m.push_str("\n\n## 影响\n");
        m.push_str(c.trim());
    }
    m.push('\n');
    m
}

/// 供 finalize 写入源文件的锚点注释文本(如 `// AEL:T-0417 决策见 adr/0023`)。
pub fn anchor_comment(task_id: &str, adr_number: i64) -> String {
    format!("// AEL:{} 决策见 adr/{:04}", task_id, adr_number)
}

fn decision_body(ev: &TaskEvent) -> String {
    match &ev.detail {
        Some(d) if !d.trim().is_empty() => format!("{}\n\n理由:{}", ev.summary.trim(), d.trim()),
        _ => ev.summary.trim().to_string(),
    }
}

fn title_from(summary: &str) -> String {
    let t = summary.trim();
    let max = 60;
    if t.chars().count() > max {
        let cut: String = t.chars().take(max).collect();
        format!("{cut}…")
    } else {
        t.to_string()
    }
}

/// 文件名友好的 slug:非字母数字(含 CJK)折成 '-',压缩连续分隔符。
fn slug(title: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in title.chars() {
        if ch.is_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "adr".to_string()
    } else {
        trimmed.chars().take(48).collect()
    }
}
