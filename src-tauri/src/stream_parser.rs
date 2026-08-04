use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
#[serde(tag = "type")]
pub enum ClaudeEvent {
    #[serde(rename = "session_started")]
    SessionStarted { session_id: String },
    #[serde(rename = "text_delta")]
    TextDelta { text: String },
    #[serde(rename = "tool_use")]
    ToolUse { id: String, name: String, input: serde_json::Value },
    #[serde(rename = "tool_result")]
    ToolResult { tool_use_id: String, is_error: bool, content: String },
    #[serde(rename = "turn_complete")]
    TurnComplete,
    #[serde(rename = "ignored")]
    Ignored,
}

pub fn parse_line(line: &str) -> ClaudeEvent {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return ClaudeEvent::Ignored;
    }
    let value: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return ClaudeEvent::Ignored, // ANSI/control bytes leak onto the tty
    };

    let msg_type = value.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match msg_type {
        "system" => {
            if let Some(id) = value.get("session_id").and_then(|s| s.as_str()) {
                return ClaudeEvent::SessionStarted { session_id: id.to_string() };
            }
            ClaudeEvent::Ignored
        }
        "assistant" => {
            // First content block only, per line, mirroring the Swift parser's
            // one-block-per-stream-json-line assumption for partial messages.
            let blocks = value.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array());
            let Some(blocks) = blocks else { return ClaudeEvent::Ignored };
            let Some(block) = blocks.first() else { return ClaudeEvent::Ignored };
            match block.get("type").and_then(|t| t.as_str()) {
                Some("text") => {
                    let text = block.get("text").and_then(|t| t.as_str()).unwrap_or("").to_string();
                    ClaudeEvent::TextDelta { text }
                }
                Some("tool_use") => {
                    let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let input = block.get("input").cloned().unwrap_or(serde_json::Value::Null);
                    ClaudeEvent::ToolUse { id, name, input }
                }
                _ => ClaudeEvent::Ignored,
            }
        }
        "user" => {
            let blocks = value.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array());
            let Some(blocks) = blocks else { return ClaudeEvent::Ignored };
            let Some(block) = blocks.first() else { return ClaudeEvent::Ignored };
            if block.get("type").and_then(|t| t.as_str()) == Some("tool_result") {
                let tool_use_id = block.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                let is_error = block.get("is_error").and_then(|v| v.as_bool()).unwrap_or(false);
                let content = block.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string();
                return ClaudeEvent::ToolResult { tool_use_id, is_error, content };
            }
            ClaudeEvent::Ignored
        }
        "result" => ClaudeEvent::TurnComplete,
        _ => ClaudeEvent::Ignored,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_system_init_into_session_started() {
        let line = r#"{"type":"system","subtype":"init","session_id":"abc-123"}"#;
        assert_eq!(parse_line(line), ClaudeEvent::SessionStarted { session_id: "abc-123".to_string() });
    }

    #[test]
    fn parses_assistant_text_block() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there"}]}}"#;
        assert_eq!(parse_line(line), ClaudeEvent::TextDelta { text: "Hi there".to_string() });
    }

    #[test]
    fn parses_assistant_tool_use_block() {
        let line = r#"{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"x.rs"}}]}}"#;
        let event = parse_line(line);
        match event {
            ClaudeEvent::ToolUse { id, name, .. } => {
                assert_eq!(id, "t1");
                assert_eq!(name, "Read");
            }
            other => panic!("expected ToolUse, got {other:?}"),
        }
    }

    #[test]
    fn parses_tool_result() {
        let line = r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","is_error":false,"content":"file contents"}]}}"#;
        assert_eq!(
            parse_line(line),
            ClaudeEvent::ToolResult { tool_use_id: "t1".to_string(), is_error: false, content: "file contents".to_string() }
        );
    }

    #[test]
    fn parses_result_as_turn_complete() {
        let line = r#"{"type":"result","subtype":"success"}"#;
        assert_eq!(parse_line(line), ClaudeEvent::TurnComplete);
    }

    #[test]
    fn ignores_non_json_ansi_leakage() {
        let line = "\x1b[2K\x1b[1G";
        assert_eq!(parse_line(line), ClaudeEvent::Ignored);
    }

    #[test]
    fn ignores_blank_lines() {
        assert_eq!(parse_line(""), ClaudeEvent::Ignored);
        assert_eq!(parse_line("   "), ClaudeEvent::Ignored);
    }
}
