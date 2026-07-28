//! 脱敏(出口③配套):transcript 落库前把密钥 / 凭证 / 私钥块替换成占位符。
//! 前端 xterm 仍收到原文(实时显示),但落 terminal_chunks 的文本先过这里。
//! 哲学:宁可多脱,不可外泄 —— 命中即替换,替换后仍保留结构可读性。

use regex::Regex;
use std::sync::OnceLock;

struct Redactors {
    kv: Regex,
    openai: Regex,
    github: Regex,
    aws: Regex,
    slack: Regex,
    bearer: Regex,
    url_cred: Regex,
    private_key: Regex,
}

fn redactors() -> &'static Redactors {
    static R: OnceLock<Redactors> = OnceLock::new();
    R.get_or_init(|| Redactors {
        // key=... / token: ... / password = ...(值取到空白或引号为止)
        kv: Regex::new(
            r#"(?i)\b(api[_-]?key|secret|token|password|passwd|authorization|auth[_-]?token|access[_-]?token)\b(\s*[:=]\s*)("?)([^\s"']{6,})"#,
        )
        .unwrap(),
        openai: Regex::new(r"\bsk-[A-Za-z0-9_\-]{16,}\b").unwrap(),
        github: Regex::new(r"\bgh[pousr]_[A-Za-z0-9]{16,}\b").unwrap(),
        aws: Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap(),
        slack: Regex::new(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}\b").unwrap(),
        bearer: Regex::new(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{12,}").unwrap(),
        // 形如 https://user:pass@host 的 URL 内嵌凭证
        url_cred: Regex::new(r"://([^:/@\s]+):([^@/\s]+)@").unwrap(),
        private_key: Regex::new(
            r"(?s)-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?-----END [A-Z0-9 ]*PRIVATE KEY-----",
        )
        .unwrap(),
    })
}

/// 对一段文本脱敏。未命中任何模式时原样返回(零拷贝语义上仍是新 String)。
pub fn redact(input: &str) -> String {
    let r = redactors();
    // 顺序:先整块私钥,再具体前缀密钥,最后通用 kv / url,避免通用规则先吃掉细节。
    let mut s = r
        .private_key
        .replace_all(input, "<REDACTED:private-key>")
        .into_owned();
    s = r.openai.replace_all(&s, "<REDACTED:openai-key>").into_owned();
    s = r.github.replace_all(&s, "<REDACTED:github-token>").into_owned();
    s = r.aws.replace_all(&s, "<REDACTED:aws-key>").into_owned();
    s = r.slack.replace_all(&s, "<REDACTED:slack-token>").into_owned();
    s = r.bearer.replace_all(&s, "Bearer <REDACTED>").into_owned();
    s = r.url_cred.replace_all(&s, "://$1:<REDACTED>@").into_owned();
    s = r.kv.replace_all(&s, "$1$2$3<REDACTED>").into_owned();
    s
}

/// 是否命中任一敏感模式(供 UI 提示「本行含已脱敏内容」)。
pub fn contains_secret(input: &str) -> bool {
    let r = redactors();
    r.private_key.is_match(input)
        || r.openai.is_match(input)
        || r.github.is_match(input)
        || r.aws.is_match(input)
        || r.slack.is_match(input)
        || r.bearer.is_match(input)
        || r.url_cred.is_match(input)
        || r.kv.is_match(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_keys() {
        assert!(redact("export OPENAI_API_KEY=sk-abcdefghijklmnop123456").contains("<REDACTED"));
        assert!(redact("token: ghp_0123456789abcdef0123").contains("<REDACTED"));
        assert!(redact("curl https://user:hunter2@host/x").contains("<REDACTED>@"));
        assert_eq!(redact("cargo build --release"), "cargo build --release");
    }

    #[test]
    fn redacts_private_key_block() {
        let raw = "-----BEGIN RSA PRIVATE KEY-----\nAAAA\nBBBB\n-----END RSA PRIVATE KEY-----";
        assert_eq!(redact(raw), "<REDACTED:private-key>");
    }
}
