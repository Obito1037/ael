//! ★ Claude Code 地盘 —— 经验引擎。
//! 经验提炼(finalize)/ Failure Guard / 检索 / 接手 Prompt。
//! 仅调用 db 层暴露的 pub API,不直接写 SQL。

pub mod finalize;
pub mod guard;
pub mod handover;
pub mod normalize;
pub mod search;
