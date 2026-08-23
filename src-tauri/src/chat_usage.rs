use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatUsage {
    /// Tokens occupying context as of the most recent API call in this
    /// session (input + cache_creation + cache_read for that one call) —
    /// the best local proxy for "how full is the context window right now".
    pub context_tokens: u64,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cache_creation_tokens: u64,
    pub total_cache_read_tokens: u64,
}

/// Claude Code stores one transcript per session at
/// `~/.claude/projects/<mangled-cwd>/<session_id>.jsonl`, where every
/// non-alphanumeric character in the session's cwd becomes `-`.
fn mangle_cwd(cwd: &str) -> String {
    cwd.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect()
}

fn transcript_path(claude_home: &Path, cwd: &str, session_id: &str) -> PathBuf {
    claude_home.join("projects").join(mangle_cwd(cwd)).join(format!("{session_id}.jsonl"))
}

/// Sums token usage across every "assistant" line in the session's own
/// transcript (each carries the full API response's `usage` block), and
/// separately keeps the last one seen as the current context-window fill.
pub fn read_usage(claude_home: &Path, cwd: &str, session_id: &str) -> Result<ChatUsage, String> {
    let path = transcript_path(claude_home, cwd, session_id);
    let contents = std::fs::read_to_string(&path).map_err(|e| format!("failed to read transcript {path:?}: {e}"))?;
    Ok(usage_from_transcript(&contents))
}

fn usage_from_transcript(contents: &str) -> ChatUsage {
    let mut usage = ChatUsage::default();
    for line in contents.lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if value.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let Some(u) = value.get("message").and_then(|m| m.get("usage")) else { continue };
        let field = |name: &str| u.get(name).and_then(|v| v.as_u64()).unwrap_or(0);
        let input = field("input_tokens");
        let output = field("output_tokens");
        let cache_creation = field("cache_creation_input_tokens");
        let cache_read = field("cache_read_input_tokens");

        usage.total_input_tokens += input;
        usage.total_output_tokens += output;
        usage.total_cache_creation_tokens += cache_creation;
        usage.total_cache_read_tokens += cache_read;
        usage.context_tokens = input + cache_creation + cache_read;
    }
    usage
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mangles_cwd_like_claude_code_does() {
        assert_eq!(
            mangle_cwd("/Users/josh/Library/Application Support/com.joshuash.vibeco/projects/x"),
            "-Users-josh-Library-Application-Support-com-joshuash-vibeco-projects-x"
        );
    }

    #[test]
    fn sums_usage_across_assistant_lines_and_keeps_latest_context() {
        let transcript = [
            r#"{"type":"system","subtype":"init","session_id":"s1"}"#,
            r#"{"type":"assistant","message":{"usage":{"input_tokens":2,"output_tokens":14,"cache_creation_input_tokens":100,"cache_read_input_tokens":0}}}"#,
            r#"{"type":"assistant","message":{"usage":{"input_tokens":3,"output_tokens":20,"cache_creation_input_tokens":0,"cache_read_input_tokens":100}}}"#,
        ]
        .join("\n");

        let usage = usage_from_transcript(&transcript);
        assert_eq!(usage.total_input_tokens, 5);
        assert_eq!(usage.total_output_tokens, 34);
        assert_eq!(usage.total_cache_creation_tokens, 100);
        assert_eq!(usage.total_cache_read_tokens, 100);
        // Latest call only: 3 + 0 + 100
        assert_eq!(usage.context_tokens, 103);
    }

    #[test]
    fn ignores_lines_without_usage() {
        let transcript = r#"{"type":"user","message":{"content":[]}}"#;
        assert_eq!(usage_from_transcript(transcript), ChatUsage::default());
    }
}
