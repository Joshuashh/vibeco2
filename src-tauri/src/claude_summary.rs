use crate::{claude_binary, git_ops};
use std::process::Command;

const BRIEF_INSTRUCTION: &str = "Summarize the following chat transcript as a short state-of-play brief for a teammate picking this up. Use three short sections: Shipped, Fixed/Changed, Next steps. Be concise — this is a handoff note, not a report.";

/// Runs a one-shot, non-streaming `claude --print` call to summarize a
/// transcript into a handoff/checkpoint brief. Unlike `claude_process`'s PTY
/// pipeline (which streams into the visible chat and broadcasts to
/// teammates as a real turn), this is a plain synchronous subprocess call —
/// same request/response shape as `git_ops::render_preview` — so it can
/// never leak into `chatStates` as a fake turn.
pub fn generate_session_brief(transcript: String) -> Result<String, String> {
    let claude_path = claude_binary::resolve_claude_binary().ok_or_else(|| "claude binary not found".to_string())?;
    let root = git_ops::repo_root()?;
    let prompt = format!("{BRIEF_INSTRUCTION}\n\n---\n\n{transcript}");

    let output = Command::new(&claude_path)
        .args(["--print", &prompt, "--output-format", "json"])
        .current_dir(&root)
        .output()
        .map_err(|e| format!("failed to run claude: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("claude exited with an error: {stderr}"));
    }

    parse_brief_output(&String::from_utf8_lossy(&output.stdout))
}

/// Pulls the `result` text out of `claude --print --output-format json`'s
/// single-object stdout.
fn parse_brief_output(stdout: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(stdout.trim()).map_err(|e| format!("failed to parse claude output: {e}"))?;
    value
        .get("result")
        .and_then(|r| r.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "claude output had no result text".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_result_text_from_json_output() {
        let stdout = r#"{"type":"result","subtype":"success","result":"Shipped: X\nFixed: Y"}"#;
        assert_eq!(parse_brief_output(stdout).unwrap(), "Shipped: X\nFixed: Y");
    }

    #[test]
    fn errors_on_missing_result_field() {
        let stdout = r#"{"type":"result","subtype":"success"}"#;
        assert!(parse_brief_output(stdout).is_err());
    }

    #[test]
    fn errors_on_non_json_output() {
        assert!(parse_brief_output("not json").is_err());
    }
}
