//! 通用工具:uuid v4、ISO-8601 UTC 时间戳。

use chrono::SecondsFormat;
use uuid::Uuid;

/// 新 uuid v4(字符串)。
pub fn new_id() -> String {
    Uuid::new_v4().to_string()
}

/// 当前 UTC 时间,ISO-8601 文本,形如 `2026-06-07T12:00:00Z`。
pub fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
