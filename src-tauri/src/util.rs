//! 通用工具:uuid v4、ISO-8601 UTC 时间戳。

use chrono::SecondsFormat;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

/// 创建不会在 Windows 桌面弹出控制台窗口的子进程命令。
///
/// AEL 启动时会探测本机 Agent CLI；这些探测只需要 stdout/stderr，不应
/// 生成可见终端。Linux/macOS 上保持标准 Command 行为。
pub fn silent_command<S: AsRef<OsStr>>(program: S) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW，避免 powershell/where/CLI --version 闪现控制台。
        command.creation_flags(0x0800_0000);
    }
    command
}

/// 新 uuid v4(字符串)。
pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

/// 当前 UTC 时间,ISO-8601 文本,形如 `2026-06-07T12:00:00Z`。
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

/// 规范化工作目录，并去掉 Windows 的 `\\?\` 前缀。
/// 带前缀的路径会让 PowerShell 提示符变形，cmd 也拒绝把它当当前目录，
/// 子进程里的 Agent 因此可能无法启动终端。
pub fn canonical_working_dir(path: &Path) -> PathBuf {
    let canonical = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    strip_verbatim_prefix(&canonical)
}

fn strip_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with(r"UNC\") => PathBuf::from(rest),
        _ => path.to_path_buf(),
    }
}

#[cfg(test)]
mod working_dir_tests {
    use super::*;

    #[test]
    fn strips_the_verbatim_prefix_from_local_paths() {
        assert_eq!(
            strip_verbatim_prefix(Path::new(r"\\?\D:\项目\demo")),
            PathBuf::from(r"D:\项目\demo")
        );
    }

    #[test]
    fn keeps_network_shares_and_ordinary_paths() {
        let unc = Path::new(r"\\?\UNC\server\share");
        assert_eq!(strip_verbatim_prefix(unc), unc.to_path_buf());
        let plain = Path::new(r"D:\demo");
        assert_eq!(strip_verbatim_prefix(plain), plain.to_path_buf());
    }
}
