//! ★ Codex 地盘 —— 数据层(SQLite CRUD、原子写入、备份)。
//!
//! 本文件提供 engine / commands 依赖的 **pub API 契约 + 一份可运行的参考实现**,
//! 使整个后端能编译、能起、E2E 跑通(满足 Phase 1 验收)。
//! Codex 接管时:保持 `Db` 的公开方法签名不变,内部实现可随意替换/优化。
//!
//! 约定(见 contracts/DECISIONS.md):
//! - 所有 id = uuid v4;时间戳 = ISO-8601 UTC 文本;tags 以 JSON 文本存。
//! - SQL 列 `trigger_text` ↔ 领域字段 `trigger`,转换在本层完成。
//! - skills 的 success_count/fail_count 由触发器维护,本层不手改。

pub mod init;
pub mod schema;

mod adr;
mod agent;
mod blame;
mod event;
mod failure;
mod policy;
mod provider;
mod skill;
mod task;

pub use provider::{McpServerConfig, ProviderConfig};

use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::Mutex;

/// `~/.ael/` 下的标准路径。
#[derive(Clone, Debug)]
pub struct AelPaths {
    pub root: PathBuf,
    pub db_file: PathBuf,
    pub backups: PathBuf,
    pub skills: PathBuf,
    pub handovers: PathBuf,
    pub briefs: PathBuf,
    pub settings_file: PathBuf,
    pub policy_file: PathBuf,
}

/// 数据层句柄。内部串行化访问同一个 SQLite 连接。
pub struct Db {
    conn: Mutex<Connection>,
    pub paths: AelPaths,
}

impl Db {
    pub(crate) fn lock(&self) -> std::sync::MutexGuard<'_, Connection> {
        // 互斥锁中毒只会在某线程 panic 持锁时发生;此处直接解包,
        // 让进程在数据层不可信时尽早失败。
        self.conn.lock().expect("db mutex poisoned")
    }
}

// ── tags JSON 互转(全层共用)────────────────────────────────

pub(crate) fn tags_to_json(tags: &[String]) -> String {
    serde_json::to_string(tags).unwrap_or_else(|_| "[]".into())
}

pub(crate) fn tags_from_json(s: &str) -> Vec<String> {
    serde_json::from_str(s).unwrap_or_default()
}
