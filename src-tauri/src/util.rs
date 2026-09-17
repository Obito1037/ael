//! 通用工具:uuid v4、ISO-8601 UTC 时间戳。

use chrono::SecondsFormat;
use std::ffi::OsStr;
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
