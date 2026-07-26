//! ★ Claude Code 地盘 —— IPC 命令注册层(遵循 contracts/ipc-commands.md)。
//! 命令为薄封装:解析入参 → 转调 engine / db → 返回契约结构。

pub mod agent;
pub mod event;
pub mod failure;
pub mod handover;
pub mod provider;
pub mod search;
pub mod settings;
pub mod skill;
pub mod task;
