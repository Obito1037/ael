//! 应用状态:数据层句柄 + 当前 Settings。由 Tauri 作为 managed state 注入命令。

use crate::agent::AgentRuntime;
use crate::db::{init, Db};
use crate::error::AelResult;
use crate::models::Settings;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub db: Db,
    pub settings: Mutex<Settings>,
    pub agents: AgentRuntime,
}

impl AppState {
    /// 在默认数据目录 `~/.ael` 初始化(建库、备份、读 Settings)。
    pub fn bootstrap() -> AelResult<Self> {
        Self::open_at(init::default_paths()?.root)
    }

    /// 在指定数据根目录初始化。供测试 / 自定义 dataDir 使用。
    pub fn open_at(root: PathBuf) -> AelResult<Self> {
        let paths = init::paths_for(root);
        let settings = init::load_settings(&paths)?;
        let db = init::open(paths)?;
        db.mark_stale_agent_sessions()?;
        db.release_stale_workspace_locks()?;
        Ok(Self {
            db,
            settings: Mutex::new(settings),
            agents: AgentRuntime::default(),
        })
    }

    pub fn settings_snapshot(&self) -> Settings {
        self.settings
            .lock()
            .expect("settings mutex poisoned")
            .clone()
    }
}
