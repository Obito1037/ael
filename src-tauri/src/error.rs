//! 统一错误形状。与 contracts/ipc-commands.md 的 `AelError` 逐字段对齐:
//! `{ code, message }`,code ∈ not_found | invalid_input | conflict | io_error | internal。
//! 所有 IPC 命令返回 `Result<T, AelError>`,失败时前端 invoke 的 Promise reject 出本结构。

use serde::Serialize;
use std::fmt;

pub type AelResult<T> = Result<T, AelError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AelError {
    pub code: String,
    pub message: String,
}

impl AelError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.to_string(),
            message: message.into(),
        }
    }
    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new("not_found", message)
    }
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::new("invalid_input", message)
    }
    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new("conflict", message)
    }
    pub fn io_error(message: impl Into<String>) -> Self {
        Self::new("io_error", message)
    }
    pub fn internal(message: impl Into<String>) -> Self {
        Self::new("internal", message)
    }
}

impl fmt::Display for AelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl std::error::Error for AelError {}

impl From<rusqlite::Error> for AelError {
    fn from(e: rusqlite::Error) -> Self {
        match e {
            rusqlite::Error::QueryReturnedNoRows => AelError::not_found("记录不存在"),
            // 唯一约束 / CHECK 约束冲突 → conflict / invalid_input
            rusqlite::Error::SqliteFailure(ref err, ref msg) => {
                let detail = msg.clone().unwrap_or_else(|| e.to_string());
                match err.code {
                    rusqlite::ErrorCode::ConstraintViolation => {
                        if detail.contains("CHECK") {
                            AelError::invalid_input(detail)
                        } else {
                            AelError::conflict(detail)
                        }
                    }
                    _ => AelError::internal(detail),
                }
            }
            other => AelError::internal(other.to_string()),
        }
    }
}

impl From<serde_json::Error> for AelError {
    fn from(e: serde_json::Error) -> Self {
        AelError::internal(format!("序列化错误: {e}"))
    }
}

impl From<std::io::Error> for AelError {
    fn from(e: std::io::Error) -> Self {
        AelError::io_error(e.to_string())
    }
}

impl From<zip::result::ZipError> for AelError {
    fn from(e: zip::result::ZipError) -> Self {
        AelError::io_error(format!("zip 错误: {e}"))
    }
}
