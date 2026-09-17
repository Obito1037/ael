//! ★ 经验引擎 + 治理引擎。
//! 经验层(1.0):finalize / guard / search / normalize / handover。
//! 治理层(2.0):policy(海关)/ redact(脱敏)/ brief(审阅)/ adr(活文档)/
//!               blame(行级溯源)/ route(智能路由)/ freshness(经验保鲜期)。
//! 仅调用 db 层暴露的 pub API,不直接写 SQL。

pub mod adr;
pub mod blame;
pub mod brief;
pub mod finalize;
pub mod freshness;
pub mod guard;
pub mod handover;
pub mod normalize;
pub mod policy;
pub mod redact;
pub mod route;
pub mod search;
