//! IPC 命令注册层。命令为薄封装:解析入参 → 转调 engine / db → 返回契约结构。
//! v1(经验层)+ v2(治理层:policy / brief / adr / blame / route)。

pub mod adr;
pub mod agent;
pub mod blame;
pub mod brief;
pub mod event;
pub mod failure;
pub mod handover;
pub mod policy;
pub mod provider;
pub mod route;
pub mod search;
pub mod settings;
pub mod skill;
pub mod task;
