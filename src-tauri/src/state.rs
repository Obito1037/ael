//! 应用状态:数据层句柄 + 当前 Settings + Agent 运行时 + 运行时海关(PolicyGate)。
//! 由 Tauri 作为 managed state 注入命令。

use crate::acp::AcpRuntime;
use crate::agent::AgentRuntime;
use crate::db::{init, Db};
use crate::engine::policy::PolicyGate;
use crate::error::AelResult;
use crate::models::Settings;
use std::path::PathBuf;
use std::sync::Mutex;

pub struct AppState {
    pub db: Db,
    pub settings: Mutex<Settings>,
    pub agents: AgentRuntime,
    /// 支持结构化会话的 ACP 通道；不支持的 profile 仍由 PTY runtime 接管。
    pub acp: AcpRuntime,
    /// 运行时海关:策略引擎 + 热更新。落盘文件在 db.paths.policy_file。
    pub gate: PolicyGate,
}

impl AppState {
    /// 按 settings.json 解析实际数据目录后初始化(建库、备份、加载 policy.toml)。
    pub fn bootstrap() -> AelResult<Self> {
        Self::open_at(init::startup_root()?)
    }

    /// 在指定数据根目录初始化。供测试 / 自定义 dataDir 使用。
    pub fn open_at(root: PathBuf) -> AelResult<Self> {
        let paths = init::paths_for(root);
        let settings = init::load_settings(&paths)?;
        let db = init::open(paths)?;
        db.mark_stale_agent_sessions()?;
        db.release_stale_workspace_locks()?;

        // 运行时海关:读取 ~/.ael/policy.toml(db::init::open 已物化默认文件)。
        let policy_text = init::load_policy_text(&db.paths)?;
        let gate = PolicyGate::new(&policy_text)?;

        Ok(Self {
            db,
            settings: Mutex::new(settings),
            agents: AgentRuntime::default(),
            acp: AcpRuntime::default(),
            gate,
        })
    }

    pub fn settings_snapshot(&self) -> Settings {
        self.settings
            .lock()
            .expect("settings mutex poisoned")
            .clone()
    }
}
