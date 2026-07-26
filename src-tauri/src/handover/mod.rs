//! ★ Codex 地盘 —— 接手包(handover.zip)打包 / 解析。
//! engine 提供 handover_prompt 文本;本模块负责落盘与读回。

pub mod pack;
pub mod schema;
pub mod unpack;

pub use pack::export_handover;
pub use unpack::import_handover;
