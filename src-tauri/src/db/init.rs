//! 初始化与备份:解析 `~/.ael/` 路径、建目录、首次建库、启动备份轮转、Settings 读写。

use super::schema::{
    MIGRATION_002_AGENT_RUNTIME, MIGRATION_003_PROVIDERS_MCP, MIGRATION_004_GOVERNANCE,
    MIGRATION_005_HISTORY_CANDIDATES, MIGRATION_006_FAILURE_VERIFICATION, POLICY_DEFAULT_TOML,
    SCHEMA_SQL, SCHEMA_VERSION,
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

/// 启动时解析实际数据根目录。
///
/// 设置页保存的 `dataDir` 位于默认目录中的 settings.json，因此启动时要先读
/// 这个小文件，再决定数据库、历史、交接包和备份的实际位置。旧安装没有该
/// 文件时仍使用默认 `~/.ael`，不会改变既有行为。
pub fn startup_root() -> AelResult<PathBuf> {
    // Per-process override for isolated verification and portable installations.
    // Never change HOME or the user's existing settings to test a new build.
    if let Some(root) = std::env::var_os("AEL_DATA_DIR") {
        let path = PathBuf::from(root);
        if !path.is_absolute() {
            return Err(AelError::invalid_input("AEL_DATA_DIR 必须为绝对路径"));
        }
        return Ok(path);
    }
    let defaults = default_paths()?;
    if !defaults.settings_file.exists() {
        return Ok(defaults.root);
    }
    let settings = load_settings(&defaults)?;
    let configured = settings.data_dir.trim();
    if configured.is_empty() {
        return Ok(defaults.root);
    }

    let expanded = expand_data_dir(configured, &defaults.root)?;
    Ok(expanded)
}

fn expand_data_dir(raw: &str, default_root: &Path) -> AelResult<PathBuf> {
    let mut value = raw.to_string();
    if value == "~" || value.starts_with("~/") || value.starts_with("~\\") {
        let home = home_dir()?;
        value = if value.len() == 1 {
            home.to_string_lossy().to_string()
        } else {
            home.join(&value[2..]).to_string_lossy().to_string()
        };
    }
    // 支持 Windows 设置中常见的 `%USERPROFILE%\\ael-data` 写法，不依赖 shell。
    let mut expanded = String::with_capacity(value.len());
    let mut rest = value.as_str();
    while let Some(start) = rest.find('%') {
        expanded.push_str(&rest[..start]);
        let after_start = &rest[start + 1..];
        let Some(end) = after_start.find('%') else {
            expanded.push('%');
            expanded.push_str(after_start);
            rest = "";
            break;
        };
        let key = &after_start[..end];
        if key.is_empty() {
            expanded.push_str("%%");
        } else if let Some(env) = std::env::var_os(key) {
            expanded.push_str(&env.to_string_lossy());
        } else {
            return Err(AelError::invalid_input(format!(
                "数据目录包含未设置的环境变量: %{key}%"
            )));
        }
        rest = &after_start[end + 1..];
    }
    expanded.push_str(rest);

    let path = PathBuf::from(expanded.trim());
    if path.as_os_str().is_empty() {
        return Ok(default_root.to_path_buf());
    }
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(default_root.join(path))
    }
}

impl Settings {
    pub fn defaults(data_dir: &Path) -> Self {
        Settings {
            data_dir: data_dir.to_string_lossy().to_string(),
            max_backups: 10,
            retrieval_mode: RetrievalMode::Keyword,
            guard_min_score: 0.35,
            codex_model: crate::models::default_codex_model(),
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

/// 原子写文件:同目录独占临时文件 + 持久化 + 平台原子替换。
///
/// Windows 替换分支参考成熟的原子写入实现。普通 rename 在
/// Windows 上不能可靠覆盖现有目标；ReplaceFileW 还能保证替换失败时旧文件仍在。
pub fn atomic_write(target: &Path, bytes: &[u8]) -> AelResult<()> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)?;
    }

    let parent = target
        .parent()
        .ok_or_else(|| AelError::invalid_input("无效的写入路径"))?;
    let file_name = target
        .file_name()
        .ok_or_else(|| AelError::invalid_input("无效的写入文件名"))?
        .to_string_lossy();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    static TEMP_COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

    let (tmp, mut file) = {
        let mut created = None;
        let mut last_collision = None;
        for _ in 0..16 {
            let counter = TEMP_COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            let candidate = parent.join(format!(
                "{file_name}.tmp.{}.{stamp}.{counter}",
                std::process::id()
            ));
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&candidate)
            {
                Ok(file) => {
                    created = Some((candidate, file));
                    break;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    last_collision = Some(error);
                }
                Err(error) => return Err(error.into()),
            }
        }
        created.ok_or_else(|| {
            AelError::from(last_collision.unwrap_or_else(|| {
                std::io::Error::new(std::io::ErrorKind::AlreadyExists, "临时文件名冲突")
            }))
        })?
    };

    use std::io::Write;
    if let Err(error) = file
        .write_all(bytes)
        .and_then(|_| file.flush())
        .and_then(|_| file.sync_all())
    {
        drop(file);
        let _ = fs::remove_file(&tmp);
        return Err(error.into());
    }
    drop(file);

    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::{
            Foundation::ERROR_NOT_SUPPORTED, Storage::FileSystem::ReplaceFileW,
        };

        let target_wide: Vec<u16> = target
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let tmp_wide: Vec<u16> = tmp
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut completed = false;
        let mut last_error = None;

        for _ in 0..3 {
            // SAFETY:两个 UTF-16 缓冲区以 NUL 结尾,且在调用期间保持有效。
            let replaced = unsafe {
                ReplaceFileW(
                    target_wide.as_ptr(),
                    tmp_wide.as_ptr(),
                    std::ptr::null(),
                    0,
                    std::ptr::null(),
                    std::ptr::null(),
                )
            };
            if replaced != 0 {
                completed = true;
                break;
            }

            let replace_error = std::io::Error::last_os_error();
            let unsupported = replace_error.raw_os_error() == Some(ERROR_NOT_SUPPORTED as i32);
            if replace_error.kind() != std::io::ErrorKind::NotFound && !unsupported {
                last_error = Some(replace_error);
                break;
            }

            match fs::rename(&tmp, target) {
                Ok(()) => {
                    completed = true;
                    break;
                }
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::AlreadyExists | std::io::ErrorKind::PermissionDenied
                    ) =>
                {
                    last_error = Some(error);
                }
                Err(error) => {
                    last_error = Some(error);
                    break;
                }
            }
        }

        if !completed {
            let error = last_error.unwrap_or_else(std::io::Error::last_os_error);
            let _ = fs::remove_file(&tmp);
            return Err(AelError::io_error(format!(
                "原子替换失败: {} -> {}: {error}",
                tmp.display(),
                target.display()
            )));
        }
    }

    #[cfg(not(windows))]
    if let Err(error) = fs::rename(&tmp, target) {
        let _ = fs::remove_file(&tmp);
        return Err(error.into());
    }

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

    if version < 5 {
        conn.execute_batch(MIGRATION_005_HISTORY_CANDIDATES)
            .map_err(|e| AelError::internal(format!("迁移到 schema v6 失败: {e}")))?;
        version = 5;
    }

    if version < 6 {
        conn.execute_batch(MIGRATION_006_FAILURE_VERIFICATION)
            .map_err(|e| AelError::internal(format!("迁移到 schema v6 失败: {e}")))?;
        version = 6;
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

#[cfg(test)]
mod tests {
    use super::{atomic_write, expand_data_dir};
    use std::path::Path;

    #[test]
    fn atomic_write_replaces_existing_file_without_losing_old_target_on_success() {
        let root = std::env::temp_dir().join(format!("ael-atomic-write-{}", crate::util::new_id()));
        std::fs::create_dir_all(&root).expect("create test dir");
        let target = root.join("settings.json");
        std::fs::write(&target, b"old").expect("seed target");

        atomic_write(&target, b"new").expect("replace target");

        assert_eq!(std::fs::read(&target).expect("read target"), b"new");
        let leftovers = std::fs::read_dir(&root)
            .expect("read test dir")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().contains(".tmp."))
            .count();
        assert_eq!(leftovers, 0);
        std::fs::remove_dir_all(root).expect("remove test dir");
    }

    #[test]
    fn expands_relative_data_dir_from_default_root() {
        let root = Path::new(r"D:\ael-default");
        assert_eq!(
            expand_data_dir("data", root).expect("expand relative path"),
            Path::new(r"D:\ael-default\data")
        );
    }

    #[test]
    fn keeps_absolute_data_dir_absolute() {
        let root = Path::new(r"D:\ael-default");
        assert_eq!(
            expand_data_dir(r"E:\ael-data", root).expect("expand absolute path"),
            Path::new(r"E:\ael-data")
        );
    }
}
