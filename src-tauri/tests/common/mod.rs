//! 测试公共工具:为每个测试开一个隔离的临时数据目录。

use ael_lib::state::AppState;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static COUNTER: AtomicU64 = AtomicU64::new(0);

pub fn unique_dir() -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!("ael-test-{}-{}-{}", std::process::id(), nanos, n))
}

/// 全新隔离的 AppState(独立 SQLite 库 + 数据目录)。
pub fn temp_state() -> AppState {
    AppState::open_at(unique_dir()).expect("init temp AppState")
}
