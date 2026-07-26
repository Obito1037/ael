//! 错误签名归一化(contracts/DECISIONS.md 决策 2)。
//!
//! 把错误文本里的易变 token 替换成占位符,得到稳定骨架 `normalized_text`,
//! 再 `sha1` 成 `signature`。目标:同一个错误第二次出现一定命中同一签名。
//!
//! 占位符顺序经过微调:更具体的模式(时间戳 / ID / 地址 / 路径)先替换,
//! 通用「独立数字」最后兜底,避免它们被 `<N>` 提前吃掉。
//! 这与 DECISIONS 表的占位符集合一致(语义不变,仅消除文档示例里的顺序歧义)。

use regex::Regex;
use sha1::{Digest, Sha1};
use std::sync::OnceLock;

struct Patterns {
    ts: Regex,
    uuid: Regex,
    long_hash: Regex,
    addr: Regex,
    path: Regex,
    loc: Regex,
    squote: Regex,
    dquote: Regex,
    number: Regex,
    ws: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        // ISO-8601 时间戳:2026-06-07T12:00:00(.123)(Z)
        ts: Regex::new(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?").unwrap(),
        uuid: Regex::new(
            r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
        )
        .unwrap(),
        // 长哈希(md5/sha 等,>=32 hex)
        long_hash: Regex::new(r"\b[0-9a-fA-F]{32,}\b").unwrap(),
        // 十六进制 / 内存地址
        addr: Regex::new(r"0x[0-9a-fA-F]+").unwrap(),
        // 绝对路径:Windows 盘符 或 Unix 多段路径
        path: Regex::new(r#"[A-Za-z]:[\\/][^\s'"`)]*|/(?:[\w.\-]+/)+[\w.\-]*"#).unwrap(),
        // 行列号 :42:7
        loc: Regex::new(r":\d+:\d+").unwrap(),
        squote: Regex::new(r"'[^']*'").unwrap(),
        dquote: Regex::new(r#""[^"]*""#).unwrap(),
        // 独立数字(含小数 / 版本号片段最后兜底)
        number: Regex::new(r"\b\d+(?:\.\d+)*\b").unwrap(),
        ws: Regex::new(r"\s+").unwrap(),
    })
}

/// 归一化:产出稳定骨架文本。
pub fn normalize(raw: &str) -> String {
    let p = patterns();
    let mut s = raw.to_string();
    s = p.ts.replace_all(&s, "<TS>").into_owned();
    s = p.uuid.replace_all(&s, "<ID>").into_owned();
    s = p.long_hash.replace_all(&s, "<ID>").into_owned();
    s = p.addr.replace_all(&s, "<ADDR>").into_owned();
    s = p.path.replace_all(&s, "<PATH>").into_owned();
    s = p.loc.replace_all(&s, "<LOC>").into_owned();
    s = p.squote.replace_all(&s, "'<VAL>'").into_owned();
    s = p.dquote.replace_all(&s, "\"<VAL>\"").into_owned();
    s = p.number.replace_all(&s, "<N>").into_owned();
    // 收尾:小写 → 合并空白 → 去首尾。
    s = s.to_lowercase();
    s = p.ws.replace_all(&s, " ").into_owned();
    s.trim().to_string()
}

/// `signature = sha1(normalized_text)`(40 位十六进制)。
pub fn signature_of(normalized_text: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(normalized_text.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::with_capacity(40);
    for b in digest {
        out.push_str(&format!("{b:02x}"));
    }
    out
}

/// 便捷:原始错误文本 → (normalized_text, signature)。
pub fn normalize_and_sign(raw: &str) -> (String, String) {
    let n = normalize(raw);
    let sig = signature_of(&n);
    (n, sig)
}
