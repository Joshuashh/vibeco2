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
            // First content block only, per line. Text blocks are *not*
            // surfaced from here — with --include-partial-messages (see
            // claude_process::build_args) this "assistant" line only ever
            // arrives once a text block is already fully complete, which is
            // what used to make responses "pop in" as one lump instead of
            // streaming. The real incremental text comes from the
            // "stream_event"/content_block_delta case below instead; this
            // arm only still matters for tool_use, whose input isn't usable
            // until fully assembled anyway (streaming raw partial JSON has
            // no honest incremental rendering).
            let blocks = value.get("message").and_then(|m| m.get("content")).and_then(|c| c.as_array());
            let Some(blocks) = blocks else { return ClaudeEvent::Ignored };
            let Some(block) = blocks.first() else { return ClaudeEvent::Ignored };
            match block.get("type").and_then(|t| t.as_str()) {
                Some("tool_use") => {
                    let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let input = block.get("input").cloned().unwrap_or(serde_json::Value::Null);
                    ClaudeEvent::ToolUse { id, name, input }
                }
                _ => ClaudeEvent::Ignored,
            }
        }
        // Emitted because claude_process::build_args passes
        // --include-partial-messages: wraps the raw Anthropic Messages API
        // SSE stream. Only content_block_delta/text_delta is useful here —
        // thinking_delta/signature_delta/input_json_delta carry nothing we
        // render incrementally (tool input still comes fully-formed from
        // the "assistant" case above once complete).
        "stream_event" => {
            let event = value.get("event");
            let event_type = event.and_then(|e| e.get("type")).and_then(|t| t.as_str()).unwrap_or("");
            if event_type != "content_block_delta" {
                return ClaudeEvent::Ignored;
            }
            let delta = event.and_then(|e| e.get("delta"));
            let delta_type = delta.and_then(|d| d.get("type")).and_then(|t| t.as_str()).unwrap_or("");
            if delta_type != "text_delta" {
                return ClaudeEvent::Ignored;
            }
            let text = delta.and_then(|d| d.get("text")).and_then(|t| t.as_str()).unwrap_or("").to_string();
            ClaudeEvent::TextDelta { text }
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
    fn ignores_assistant_text_block_now_carried_by_stream_event() {
        // The full-text "assistant" line arrives only once the block is
        // already complete — real incremental text comes from
        // content_block_delta instead (see below), so this would double up
        // the text if also surfaced here.
        let line = r#"{"type":"assistant","message":{"content":[{"type":"text","text":"Hi there"}]}}"#;
        assert_eq!(parse_line(line), ClaudeEvent::Ignored);
    }

    #[test]
    fn parses_stream_event_text_delta() {
        let line = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi "}}}"#;
        assert_eq!(parse_line(line), ClaudeEvent::TextDelta { text: "Hi ".to_string() });
    }

    #[test]
    fn ignores_non_text_stream_event_deltas() {
        let thinking = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"..."}}}"#;
        assert_eq!(parse_line(thinking), ClaudeEvent::Ignored);
        let input_json = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}}"#;
        assert_eq!(parse_line(input_json), ClaudeEvent::Ignored);
        let message_start = r#"{"type":"stream_event","event":{"type":"message_start"}}"#;
        assert_eq!(parse_line(message_start), ClaudeEvent::Ignored);
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
