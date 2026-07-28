//! 初始化与备份:解析 `~/.ael/` 路径、建目录、首次建库、启动备份轮转、Settings 读写。

use super::schema::{
    MIGRATION_002_AGENT_RUNTIME, MIGRATION_003_PROVIDERS_MCP, MIGRATION_004_GOVERNANCE,
    POLICY_DEFAULT_TOML, SCHEMA_SQL, SCHEMA_VERSION,
};
use super::{AelPaths, Db};
use crate::error::{AelError, AelResult};
use crate::models::{RetrievalMode, Settings};
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// 解析用户主目录(跨平台,不引第三方依赖)。
fn home_dir() -> AelResult<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| AelError::io_error("无法定位用户主目录(HOME / USERPROFILE 均未设置)"))
}

/// 由数据根目录推导全部标准路径。
pub fn paths_for(root: PathBuf) -> AelPaths {
    AelPaths {
        db_file: root.join("ael.db"),
        backups: root.join("backups"),
        skills: root.join("skills"),
        handovers: root.join("handovers"),
        briefs: root.join("briefs"),
        settings_file: root.join("settings.json"),
        policy_file: root.join("policy.toml"),
        root,
    }
}

/// 默认数据目录 `~/.ael`。
pub fn default_paths() -> AelResult<AelPaths> {
    Ok(paths_for(home_dir()?.join(".ael")))
}

impl Settings {
    pub fn defaults(data_dir: &Path) -> Self {
        Settings {
            data_dir: data_dir.to_string_lossy().to_string(),
            max_backups: 10,
            retrieval_mode: RetrievalMode::Keyword,
            guard_min_score: 0.35,
        }
    }
}

/// 读取 Settings;文件不存在则写入并返回默认值。
pub fn load_settings(paths: &AelPaths) -> AelResult<Settings> {
    if paths.settings_file.exists() {
        let text = fs::read_to_string(&paths.settings_file)?;
        let s: Settings = serde_json::from_str(&text)
            .map_err(|e| AelError::internal(format!("settings.json 解析失败: {e}")))?;
        Ok(s)
    } else {
        let s = Settings::defaults(&paths.root);
        save_settings(paths, &s)?;
        Ok(s)
    }
}

/// 原子写入 Settings:写临时文件 → rename 覆盖,避免半截文件。
pub fn save_settings(paths: &AelPaths, settings: &Settings) -> AelResult<()> {
    let text = serde_json::to_string_pretty(settings)?;
    atomic_write(&paths.settings_file, text.as_bytes())
}

/// 读取海关策略文本;文件缺失则物化默认并返回默认(用户删除后仍可用)。
pub fn load_policy_text(paths: &AelPaths) -> AelResult<String> {
    if paths.policy_file.exists() {
        Ok(fs::read_to_string(&paths.policy_file)?)
    } else {
        atomic_write(&paths.policy_file, POLICY_DEFAULT_TOML.as_bytes())?;
        Ok(POLICY_DEFAULT_TOML.to_string())
    }
}

/// 原子写入海关策略文本(校验在 gate 层完成)。
pub fn save_policy_text(paths: &AelPaths, text: &str) -> AelResult<()> {
    atomic_write(&paths.policy_file, text.as_bytes())
}

/// 原子写文件:同目录临时文件 + 持久化 + rename。
pub fn atomic_write(target: &Path, bytes: &[u8]) -> AelResult<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = target.with_extension(format!(
        "tmp-{}",
        crate::util::new_id().split('-').next().unwrap_or("0")
    ));
    {
        use std::io::Write;
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, target)?;
    Ok(())
}

/// 打开(或首次创建)数据库,完成建目录、建库、启动备份。
pub fn open(paths: AelPaths) -> AelResult<Db> {
    // 1. 建目录
    for dir in [
        &paths.root,
        &paths.backups,
        &paths.skills,
        &paths.handovers,
        &paths.briefs,
    ] {
        fs::create_dir_all(dir)?;
    }

    // 2. 读 Settings(同时落地默认);物化默认海关策略(用户删除后重启即恢复)
    let settings = load_settings(&paths)?;
    if !paths.policy_file.exists() {
        atomic_write(&paths.policy_file, POLICY_DEFAULT_TOML.as_bytes())?;
    }

    // 3. 已有库 → 启动前备份并轮转
    if paths.db_file.exists() && fs::metadata(&paths.db_file)?.len() > 0 {
        if let Err(e) = backup_db(&paths, settings.max_backups) {
            log::warn!("启动备份失败(继续启动): {e}");
        }
    }

    // 4. 打开连接 + PRAGMA
    let conn = Connection::open(&paths.db_file)
        .map_err(|e| AelError::io_error(format!("打开数据库失败: {e}")))?;
    conn.pragma_update(None, "foreign_keys", true)?;
    // journal_mode 会返回一行结果,用 query_row 读掉,避免 pragma_update 报「返回了结果」。
    let _: String = conn
        .query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0))
        .unwrap_or_default();

    // 5. 空库 → 建表
    bootstrap_if_needed(&conn)?;

    Ok(Db {
        conn: Mutex::new(conn),
        paths,
    })
}

/// 检查 schema_meta 是否存在;不存在视为空库,整段执行 schema.sql。
fn bootstrap_if_needed(conn: &Connection) -> AelResult<()> {
    let has_meta: bool = conn
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_meta'",
            [],
            |_| Ok(true),
        )
        .unwrap_or(false);

    if !has_meta {
        // 新库:建 v1 基线后,继续往下跑增量迁移(不再提前 return,
        // 否则全新安装首次启动会缺 agent/provider 等后续版本的表)。
        conn.execute_batch(SCHEMA_SQL)
            .map_err(|e| AelError::internal(format!("建库失败: {e}")))?;
    }

    // 按版本顺序做增量迁移。
    let mut version: i64 = conn
        .query_row(
            "SELECT value FROM schema_meta WHERE key='version'",
            [],
            |r| {
                let v: String = r.get(0)?;
                Ok(v.parse::<i64>().unwrap_or(0))
            },
        )
        .unwrap_or(0);

    if version < 2 {
        conn.execute_batch(MIGRATION_002_AGENT_RUNTIME)
            .map_err(|e| AelError::internal(format!("迁移到 schema v2 失败: {e}")))?;
        version = 2;
    }

    if version < 3 {
        conn.execute_batch(MIGRATION_003_PROVIDERS_MCP)
            .map_err(|e| AelError::internal(format!("迁移到 schema v3 失败: {e}")))?;
        version = 3;
    }

    if version < 4 {
        conn.execute_batch(MIGRATION_004_GOVERNANCE)
            .map_err(|e| AelError::internal(format!("迁移到 schema v4 失败: {e}")))?;
        version = 4;
    }

    if version > SCHEMA_VERSION {
        log::warn!("schema 版本高于当前代码:库={version} 代码期望={SCHEMA_VERSION}");
    }
    Ok(())
}

/// 复制当前库到 backups/,再把备份数裁剪到最近 max_backups 份。
pub fn backup_db(paths: &AelPaths, max_backups: u32) -> AelResult<PathBuf> {
    // 文件名安全的紧凑时间戳(无冒号,Windows 友好):20260607T120000Z
    let ts = chrono::Utc::now().format("%Y%m%dT%H%M%SZ").to_string();
    let dest = paths.backups.join(format!("ael-{ts}.db"));
    fs::copy(&paths.db_file, &dest)?;
    prune_backups(paths, max_backups)?;
    Ok(dest)
}

/// 仅保留最近 max_backups 份 ael-*.db,其余删除。
fn prune_backups(paths: &AelPaths, max_backups: u32) -> AelResult<()> {
    let mut backups: Vec<PathBuf> = fs::read_dir(&paths.backups)?
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("ael-") && n.ends_with(".db"))
                .unwrap_or(false)
        })
        .collect();
    // 文件名按时间戳词法升序 == 时间升序;旧的在前。
    backups.sort();
    let keep = max_backups as usize;
    if backups.len() > keep {
        for old in &backups[..backups.len() - keep] {
            let _ = fs::remove_file(old);
        }
    }
    Ok(())
}
