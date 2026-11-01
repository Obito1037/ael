// 桌面端禁用 Windows 控制台窗口。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Release builds have no console. Preserve panic evidence locally instead
    // of leaving an unexplained disappearing window. No data is transmitted.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        use std::io::Write;
        let base = std::env::var_os("AEL_DATA_DIR")
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::var_os("LOCALAPPDATA").map(|p| std::path::PathBuf::from(p).join("AEL3")));
        if let Some(base) = base {
            let logs = base.join("logs");
            if std::fs::create_dir_all(&logs).is_ok() {
                if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(logs.join("panic.log")) {
                    let _ = writeln!(file, "[{}] {}\n{}", chrono::Utc::now().to_rfc3339(), info, std::backtrace::Backtrace::force_capture());
                }
            }
        }
        default_hook(info);
    }));
    ael3_lib::run();
}
