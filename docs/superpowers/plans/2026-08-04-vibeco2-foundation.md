# Vibeco2 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get one person's chat working end-to-end — a Tauri desktop app that spawns a local `claude` CLI process over a PTY, streams its `stream-json` output into a chat UI (ordered text/tool-call blocks, live updates), and persists chat history to Supabase. No multiplayer, no Canvas view, no Main Agent orchestration yet — those are later plans (see `spec.md` §2.2, §4).

**Architecture:** Tauri (Rust backend) + React/TypeScript frontend, single window. Rust owns the PTY and the `claude` subprocess; it parses `stream-json` lines into typed events and emits them to the frontend over Tauri's event system. React owns rendering and holds the live message list in memory; on stream completion it persists to Supabase (Postgres) so history survives reload. This plan deliberately ports two hard-won patterns from the existing native Swift `Claude Code GUI` codebase (`../Claude Code GUI/Sources/Claudeville/ClaudeProcess.swift` and its `decisions.md`) rather than rediscovering them: (1) PTY echo must be disabled on the slave fd or writes to stdin corrupt the JSON stream, and (2) a message's content must be one ordered list of blocks (text/tool-call interleaved), never a flat text field plus a separate tools array — a past bug came from splitting those.

**Tech Stack:** Tauri 2, Rust, `portable-pty` crate, React 19 + TypeScript + Vite, Supabase (Postgres client via `@supabase/supabase-js`).

**Note (added after an incident during execution, see `decisions.md`):** Task 1 originally ran `create-tauri-app --force` directly inside this directory, which wipes non-generated files first — it deleted `spec.md`/`HANDOFF.md`/`decisions.md`/`docs/`. Those were recovered from conversation context. Task 1, Step 1 below is corrected to scaffold into a temp directory and move only the generated files in, so this can't happen again.

---

## File Structure

- `src-tauri/Cargo.toml` — add `portable-pty`, `serde`, `serde_json`
- `src-tauri/src/claude_binary.rs` — resolves the `claude` executable path (port of `ClaudeBinaryResolver`)
- `src-tauri/src/claude_process.rs` — PTY spawn, CLI arg construction, line-buffered reader, one instance per session
- `src-tauri/src/stream_parser.rs` — parses a `stream-json` line into a typed `ClaudeEvent`, emits it via Tauri
- `src-tauri/src/lib.rs` — registers Tauri commands (`start_session`, `send_message`) and the process registry
- `src/types/message.ts` — `Message`, `ContentBlock` (ordered text/tool-call union), `ClaudeEvent` types (TS mirror of the Rust event enum)
- `src/lib/claudeEvents.ts` — subscribes to Tauri events, reduces them into `Message[]` state updates
- `src/components/ChatView.tsx` — message list + streaming indicator
- `src/components/MessageBlock.tsx` — renders one content block (text or tool-call row)
- `src/components/InputBar.tsx` — prompt textarea + send button
- `src/lib/supabase.ts` — Supabase client init
- `src/lib/persistChat.ts` — save/load chat history
- `supabase/migrations/0001_chats.sql` — `chats` and `messages` tables

---

## Task 1: Scaffold the Tauri + React app

**Files:**
- Create: whole `Vibeco2/` app skeleton via `npm create tauri-app@latest`

- [ ] **Step 1: Initialize git (if not already done) and scaffold into a temp directory, then merge in**

Never run a scaffolder with a force/overwrite flag directly inside a directory that already has files worth keeping — scaffold into an empty temp dir first, then move the generated files into place.

```bash
cd "/Users/joshuash/Library/CloudStorage/GoogleDrive-joshuashurst@gmail.com/My Drive/Projects/Ohayo Studio/Projects/Development/Vibeco2"
git init  # skip if already a repo
mkdir -p /tmp/vibeco2-scaffold
npx create-tauri-app@latest /tmp/vibeco2-scaffold --template react-ts --manager npm --yes
cp -R /tmp/vibeco2-scaffold/. .
rm -rf /tmp/vibeco2-scaffold
```

Confirm nothing pre-existing was clobbered:

```bash
ls spec.md HANDOFF.md decisions.md docs
```

Expected: all four still present, alongside the new `src/`, `src-tauri/`, `package.json`, etc.

- [ ] **Step 2: Verify the scaffold builds and runs**

Run: `npm install && npm run tauri dev`
Expected: a native window opens showing the default Tauri+React starter page (Vite dev server behind it, no errors in the terminal).

Close the dev window once confirmed.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri + React app"
```

---

## Task 2: Resolve the `claude` binary path

**Files:**
- Create: `src-tauri/src/claude_binary.rs`
- Modify: `src-tauri/src/lib.rs`

Ports `ClaudeBinaryResolver.resolve()` from `../Claude Code GUI/Sources/Claudeville/ClaudeProcess.swift`: GUI apps on macOS don't inherit the shell's `$PATH`, so check common install locations first, then fall back to asking the user's login shell.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/claude_binary.rs (top of file, below the function)
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_finds_something_on_this_dev_machine() {
        // This machine has `claude` installed (required to develop Vibeco2 at all).
        let result = resolve_claude_binary();
        assert!(result.is_some(), "expected to find a claude binary on PATH or in common install dirs");
    }
}
```

- [ ] **Step 2: Run test to verify it fails (function doesn't exist yet)**

Run: `cd src-tauri && cargo test resolve_finds_something_on_this_dev_machine`
Expected: FAIL with "cannot find function `resolve_claude_binary`"

- [ ] **Step 3: Write the implementation**

```rust
// src-tauri/src/claude_binary.rs
use std::path::PathBuf;
use std::process::Command;

/// Resolves the path to the `claude` CLI binary.
/// GUI apps on macOS launch with a minimal PATH, so we check common
/// install locations first, then fall back to the user's login shell
/// (`which claude` under `sh -lic`) which picks up nvm/homebrew/etc shims.
pub fn resolve_claude_binary() -> Option<PathBuf> {
    let common_paths = [
        "/usr/local/bin/claude",
        "/opt/homebrew/bin/claude",
    ];
    for path in common_paths {
        let candidate = PathBuf::from(path);
        if candidate.is_file() {
            return Some(candidate);
        }
    }

    let output = Command::new("sh")
        .arg("-lic")
        .arg("which claude")
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let path_str = String::from_utf8(output.stdout).ok()?;
    let trimmed = path_str.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}
```

- [ ] **Step 4: Register the module**

```rust
// src-tauri/src/lib.rs — add near the top with other `mod` declarations
mod claude_binary;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd src-tauri && cargo test resolve_finds_something_on_this_dev_machine`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/claude_binary.rs src-tauri/src/lib.rs
git commit -m "feat: resolve claude CLI binary path"
```

---

## Task 3: Add the PTY crate and open a PTY with echo disabled

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/claude_process.rs`

This is the single most important gotcha ported from the Swift codebase's `decisions.md`: the PTY's slave side must have `ECHO` turned off, or bytes written to stdin get echoed back into stdout and corrupt the line-based JSON parser downstream.

- [ ] **Step 1: Add the `portable-pty` dependency**

```toml
# src-tauri/Cargo.toml — add under [dependencies]
portable-pty = "0.8"
```

Run: `cd src-tauri && cargo build`
Expected: dependency resolves and builds cleanly.

- [ ] **Step 2: Write the failing test**

```rust
// src-tauri/src/claude_process.rs
use portable_pty::{native_pty_system, PtySize};

pub fn open_pty() -> Result<Box<dyn portable_pty::MasterPty + Send>, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 40,
            cols: 120,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("failed to open pty: {e}"))?;
    disable_echo(&*pair.slave)?;
    Ok(pair.master)
}

fn disable_echo(slave: &dyn portable_pty::SlavePty) -> Result<(), String> {
    // portable-pty exposes the underlying fd on unix; termios ECHO must be
    // cleared or writes to stdin echo back into the stream we're parsing
    // as JSON (see Claude Code GUI decisions.md: "PTY echo disabled").
    #[cfg(unix)]
    {
        use std::os::unix::io::AsRawFd;
        if let Some(fd) = slave.as_raw_fd() {
            unsafe {
                let mut term: libc::termios = std::mem::zeroed();
                if libc::tcgetattr(fd, &mut term) != 0 {
                    return Err("tcgetattr failed".into());
                }
                term.c_lflag &= !libc::ECHO;
                if libc::tcsetattr(fd, libc::TCSANOW, &term) != 0 {
                    return Err("tcsetattr failed".into());
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn open_pty_succeeds() {
        let result = open_pty();
        assert!(result.is_ok(), "expected PTY to open: {:?}", result.err());
    }
}
```

- [ ] **Step 3: Add `libc` dependency (needed for termios)**

```toml
# src-tauri/Cargo.toml — add under [dependencies]
libc = "0.2"
```

- [ ] **Step 4: Register the module and run the test**

```rust
// src-tauri/src/lib.rs
mod claude_process;
```

Run: `cd src-tauri && cargo test open_pty_succeeds`
Expected: PASS (opens and closes a real PTY on the dev machine — this is an integration-style test, acceptable here since PTY behavior can't be meaningfully mocked).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/src/claude_process.rs src-tauri/src/lib.rs
git commit -m "feat: open PTY with echo disabled"
```

---

## Task 4: Spawn `claude` over the PTY with the stream-json flag recipe

**Files:**
- Modify: `src-tauri/src/claude_process.rs`

Ports the flag set from `ClaudeProcess.run(...)` in the Swift codebase: `--print <prompt> --output-format stream-json --verbose --include-partial-messages --model <model> --permission-mode <mode>`.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/claude_process.rs — append
pub struct SpawnConfig {
    pub prompt: String,
    pub model: String,
    pub working_directory: PathBuf,
    pub resume_session_id: Option<String>,
}

pub fn build_args(config: &SpawnConfig) -> Vec<String> {
    let mut args = vec![
        "--print".to_string(),
        config.prompt.clone(),
        "--output-format".to_string(),
        "stream-json".to_string(),
        "--verbose".to_string(),
        "--include-partial-messages".to_string(),
        "--model".to_string(),
        config.model.clone(),
        "--permission-mode".to_string(),
        "acceptEdits".to_string(),
    ];
    if let Some(id) = &config.resume_session_id {
        args.push("--resume".to_string());
        args.push(id.clone());
    }
    args
}

#[cfg(test)]
mod spawn_config_tests {
    use super::*;

    #[test]
    fn build_args_includes_stream_json_flags() {
        let config = SpawnConfig {
            prompt: "hello".to_string(),
            model: "sonnet".to_string(),
            working_directory: PathBuf::from("/tmp"),
            resume_session_id: None,
        };
        let args = build_args(&config);
        assert_eq!(args[0], "--print");
        assert_eq!(args[1], "hello");
        assert!(args.contains(&"stream-json".to_string()));
        assert!(args.contains(&"--include-partial-messages".to_string()));
        assert!(!args.contains(&"--resume".to_string()));
    }

    #[test]
    fn build_args_includes_resume_when_present() {
        let config = SpawnConfig {
            prompt: "continue".to_string(),
            model: "sonnet".to_string(),
            working_directory: PathBuf::from("/tmp"),
            resume_session_id: Some("abc-123".to_string()),
        };
        let args = build_args(&config);
        assert!(args.contains(&"--resume".to_string()));
        assert!(args.contains(&"abc-123".to_string()));
    }
}
```

Add `use std::path::PathBuf;` to the top of the file if not already present from Task 3.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test build_args`
Expected: FAIL (`build_args` undefined) until Step 1's code is saved, then PASS immediately since the implementation is written inline with the test in this port. Confirm PASS.

- [ ] **Step 3: Write the spawn function using `build_args` and the PTY from Task 3**

```rust
// src-tauri/src/claude_process.rs — append
use portable_pty::CommandBuilder;
use std::io::{BufRead, BufReader};

pub struct ClaudeSession {
    pub master: Box<dyn portable_pty::MasterPty + Send>,
    pub child: Box<dyn portable_pty::Child + Send + Sync>,
}

/// Spawns one `claude` process for one session. Not a singleton — each
/// chat/session in Vibeco2 gets its own ClaudeSession, matching the
/// "one ClaudeProcess per session" lesson from the Swift codebase.
pub fn spawn_session(
    claude_path: &std::path::Path,
    config: &SpawnConfig,
) -> Result<ClaudeSession, String> {
    let pty_system = portable_pty::native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows: 40, cols: 120, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| format!("failed to open pty: {e}"))?;
    disable_echo(&*pair.slave)?;

    let mut cmd = CommandBuilder::new(claude_path);
    for arg in build_args(config) {
        cmd.arg(arg);
    }
    cmd.cwd(&config.working_directory);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to spawn claude: {e}"))?;

    Ok(ClaudeSession { master: pair.master, child })
}

pub fn reader_for(session: &ClaudeSession) -> Result<BufReader<Box<dyn std::io::Read + Send>>, String> {
    let reader = session
        .master
        .try_clone_reader()
        .map_err(|e| format!("failed to clone pty reader: {e}"))?;
    Ok(BufReader::new(reader))
}
```

- [ ] **Step 4: Run the full test suite for this file**

Run: `cd src-tauri && cargo test claude_process`
Expected: PASS (all tests including `open_pty_succeeds`, `build_args_includes_stream_json_flags`, `build_args_includes_resume_when_present`).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/claude_process.rs
git commit -m "feat: spawn claude CLI over PTY with stream-json args"
```

---

## Task 5: Parse `stream-json` lines into typed events

**Files:**
- Create: `src-tauri/src/stream_parser.rs`
- Modify: `src-tauri/src/lib.rs`

Ports the event model from `ClaudeProcess.handle(line:)`: `system`/`init`, `assistant` (text + `tool_use` blocks, deduped by tool id), `user` (`tool_result` matched by `tool_use_id`), `result`. Non-JSON lines (ANSI leakage) are ignored, not errors.

- [ ] **Step 1: Write the failing test**

```rust
// src-tauri/src/stream_parser.rs
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
            let blocks = value
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array());
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
            let blocks = value
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array());
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
```

- [ ] **Step 2: Register the module**

```rust
// src-tauri/src/lib.rs
mod stream_parser;
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `cd src-tauri && cargo test stream_parser`
Expected: PASS on all 6 tests.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/stream_parser.rs src-tauri/src/lib.rs
git commit -m "feat: parse stream-json lines into typed ClaudeEvent"
```

---

## Task 6: Wire a Tauri command that spawns a session and emits events to the frontend

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the `start_session` command**

```rust
// src-tauri/src/lib.rs
use std::io::BufRead;
use tauri::{AppHandle, Emitter};

#[tauri::command]
fn start_session(app: AppHandle, prompt: String, working_directory: String) -> Result<(), String> {
    let claude_path = claude_binary::resolve_claude_binary()
        .ok_or_else(|| "claude binary not found".to_string())?;

    let config = claude_process::SpawnConfig {
        prompt,
        model: "sonnet".to_string(),
        working_directory: std::path::PathBuf::from(working_directory),
        resume_session_id: None,
    };

    let session = claude_process::spawn_session(&claude_path, &config)?;
    let mut reader = claude_process::reader_for(&session)?;

    std::thread::spawn(move || {
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) => break, // EOF, process exited
                Ok(_) => {
                    let event = stream_parser::parse_line(&line);
                    if event != stream_parser::ClaudeEvent::Ignored {
                        let _ = app.emit("claude-event", &event);
                    }
                }
                Err(_) => break,
            }
        }
        // Keep the child alive in this closure until the reader loop ends,
        // otherwise it drops (and the process is killed) as soon as spawn_session returns.
        drop(session);
    });

    Ok(())
}
```

- [ ] **Step 2: Register the command in the Tauri builder**

```rust
// src-tauri/src/lib.rs — inside the existing tauri::Builder::default() chain,
// find .invoke_handler(tauri::generate_handler![...]) and add start_session:
.invoke_handler(tauri::generate_handler![start_session])
```

If no `invoke_handler` call exists yet in the scaffolded `lib.rs`, add one to the builder chain before `.run(...)`.

- [ ] **Step 3: Build to verify it compiles**

Run: `cd src-tauri && cargo build`
Expected: builds with no errors (warnings about unused fields are fine at this stage).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add start_session Tauri command emitting claude-event"
```

---

## Task 7: TypeScript message model — ordered content blocks

**Files:**
- Create: `src/types/message.ts`

Mirrors the Rust `ClaudeEvent` enum and encodes the key architectural lesson from `decisions.md`: a message's content is one ordered array of blocks, never a separate text field plus a tools array — that split caused a real bug when streamed content interleaved text and tool calls.

- [ ] **Step 1: Write the failing test**

```typescript
// src/types/message.test.ts
import { describe, it, expect } from "vitest";
import { reduceEvent, type Message } from "./message";

describe("reduceEvent", () => {
  it("appends a text block on text_delta", () => {
    const messages: Message[] = [];
    const result = reduceEvent(messages, { type: "text_delta", text: "Hi" });
    expect(result).toHaveLength(1);
    expect(result[0].blocks).toEqual([{ kind: "text", text: "Hi" }]);
  });

  it("keeps text and a following tool_use as one ordered block list on the same message", () => {
    let messages: Message[] = [];
    messages = reduceEvent(messages, { type: "text_delta", text: "Let me check " });
    messages = reduceEvent(messages, { type: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" } });
    expect(messages).toHaveLength(1);
    expect(messages[0].blocks).toEqual([
      { kind: "text", text: "Let me check " },
      { kind: "tool_use", id: "t1", name: "Read", input: { file_path: "a.ts" }, result: null },
    ]);
  });

  it("attaches a tool_result to the matching tool_use block by id", () => {
    let messages: Message[] = [];
    messages = reduceEvent(messages, { type: "tool_use", id: "t1", name: "Read", input: {} });
    messages = reduceEvent(messages, { type: "tool_result", tool_use_id: "t1", is_error: false, content: "file contents" });
    const block = messages[0].blocks[0];
    expect(block.kind).toBe("tool_use");
    if (block.kind === "tool_use") {
      expect(block.result).toEqual({ isError: false, content: "file contents" });
    }
  });

  it("starts a new message after turn_complete", () => {
    let messages: Message[] = [];
    messages = reduceEvent(messages, { type: "text_delta", text: "first turn" });
    messages = reduceEvent(messages, { type: "turn_complete" });
    messages = reduceEvent(messages, { type: "text_delta", text: "second turn" });
    expect(messages).toHaveLength(2);
    expect(messages[1].blocks).toEqual([{ kind: "text", text: "second turn" }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/types/message.test.ts`
Expected: FAIL (`./message` module doesn't exist yet). If vitest isn't installed yet, run `npm install -D vitest` first.

- [ ] **Step 3: Write the implementation**

```typescript
// src/types/message.ts

export type ClaudeEvent =
  | { type: "session_started"; session_id: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; is_error: boolean; content: string }
  | { type: "turn_complete" };

export type ContentBlock =
  | { kind: "text"; text: string }
  | {
      kind: "tool_use";
      id: string;
      name: string;
      input: unknown;
      result: { isError: boolean; content: string } | null;
    };

export interface Message {
  role: "assistant";
  blocks: ContentBlock[];
  complete: boolean;
}

/**
 * Reduces one ClaudeEvent into the running Message[] list. Text and tool-use
 * blocks accumulate onto the same, currently-open message as one ordered
 * array — never split into separate text/tools fields (see decisions.md:
 * "Message content: ordered blocks, not a flat text field + tools array").
 */
export function reduceEvent(messages: Message[], event: ClaudeEvent): Message[] {
  if (event.type === "session_started") {
    return messages;
  }

  if (event.type === "turn_complete") {
    if (messages.length === 0) return messages;
    const next = [...messages];
    next[next.length - 1] = { ...next[next.length - 1], complete: true };
    return next;
  }

  const openMessage = messages[messages.length - 1];
  const needsNewMessage = !openMessage || openMessage.complete;
  const current: Message = needsNewMessage
    ? { role: "assistant", blocks: [], complete: false }
    : openMessage;

  let blocks: ContentBlock[];
  if (event.type === "text_delta") {
    blocks = [...current.blocks, { kind: "text", text: event.text }];
  } else if (event.type === "tool_use") {
    blocks = [
      ...current.blocks,
      { kind: "tool_use", id: event.id, name: event.name, input: event.input, result: null },
    ];
  } else if (event.type === "tool_result") {
    blocks = current.blocks.map((block) =>
      block.kind === "tool_use" && block.id === event.tool_use_id
        ? { ...block, result: { isError: event.is_error, content: event.content } }
        : block
    );
  } else {
    blocks = current.blocks;
  }

  const updatedMessage: Message = { ...current, blocks };
  return needsNewMessage ? [...messages, updatedMessage] : [...messages.slice(0, -1), updatedMessage];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/types/message.test.ts`
Expected: PASS on all 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/types/message.ts src/types/message.test.ts
git commit -m "feat: ordered content-block message model with event reducer"
```

---

## Task 8: Chat UI — message list, tool-call rows, streaming, input bar

**Files:**
- Create: `src/components/MessageBlock.tsx`
- Create: `src/components/ChatView.tsx`
- Create: `src/components/InputBar.tsx`
- Modify: `src/App.tsx`

Tool-call summaries port the "verb + filename + diff badge" convention from `ToolViews.swift`'s `describe(tool:input:)`, simplified to the tools relevant at this stage (Read/Write/Edit/Bash).

- [ ] **Step 1: Write `MessageBlock.tsx`**

```tsx
// src/components/MessageBlock.tsx
import type { ContentBlock } from "../types/message";

function describeTool(name: string, input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Read":
      return `Read ${String(record.file_path ?? "")}`;
    case "Write":
      return `Wrote ${String(record.file_path ?? "")}`;
    case "Edit":
      return `Edited ${String(record.file_path ?? "")}`;
    case "Bash":
      return `Ran: ${String(record.command ?? "")}`;
    default:
      return name;
  }
}

export function MessageBlock({ block }: { block: ContentBlock }) {
  if (block.kind === "text") {
    return <p className="message-text">{block.text}</p>;
  }

  return (
    <div className={`tool-row ${block.result?.isError ? "tool-row-error" : ""}`}>
      <span className="tool-summary">{describeTool(block.name, block.input)}</span>
      {block.result && <span className="tool-status">{block.result.isError ? "failed" : "done"}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Write `ChatView.tsx`**

```tsx
// src/components/ChatView.tsx
import type { Message } from "../types/message";
import { MessageBlock } from "./MessageBlock";

export function ChatView({ messages }: { messages: Message[] }) {
  return (
    <div className="chat-view">
      {messages.map((message, i) => (
        <div key={i} className="message">
          {message.blocks.map((block, j) => (
            <MessageBlock key={j} block={block} />
          ))}
          {!message.complete && <span className="thinking-indicator">●</span>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Write `InputBar.tsx`**

```tsx
// src/components/InputBar.tsx
import { useState } from "react";

export function InputBar({ onSend, disabled }: { onSend: (prompt: string) => void; disabled: boolean }) {
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || disabled) return;
    onSend(value);
    setValue("");
  }

  return (
    <form className="input-bar" onSubmit={handleSubmit}>
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Message Claude..."
        disabled={disabled}
      />
      <button type="submit" disabled={disabled || !value.trim()}>
        Send
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Wire it into `App.tsx`**

```tsx
// src/App.tsx
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatView } from "./components/ChatView";
import { InputBar } from "./components/InputBar";
import { reduceEvent, type Message, type ClaudeEvent } from "./types/message";

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    const unlisten = listen<ClaudeEvent>("claude-event", (event) => {
      setMessages((prev) => reduceEvent(prev, event.payload));
      if (event.payload.type === "turn_complete") {
        setStreaming(false);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSend = useCallback((prompt: string) => {
    setStreaming(true);
    invoke("start_session", { prompt, workingDirectory: "." }).catch((err) => {
      console.error("start_session failed", err);
      setStreaming(false);
    });
  }, []);

  return (
    <div className="app">
      <ChatView messages={messages} />
      <InputBar onSend={handleSend} disabled={streaming} />
    </div>
  );
}

export default App;
```

- [ ] **Step 5: Run the app and manually verify end-to-end streaming**

Run: `npm run tauri dev`
In the opened window, type a short prompt (e.g. "say hello") and press Send.
Expected: the window shows the assistant's text streaming in, and if the prompt triggers a tool call, a tool-row line appears with a summary and a "done"/"failed" status.

- [ ] **Step 6: Commit**

```bash
git add src/components src/App.tsx
git commit -m "feat: chat UI with streaming messages and tool-call rows"
```

---

## Task 9: Supabase schema for chat persistence

**Files:**
- Create: `supabase/migrations/0001_chats.sql`
- Create: `src/lib/supabase.ts`
- Create: `.env.example`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0001_chats.sql
create table chats (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  title text
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references chats(id) on delete cascade,
  role text not null,
  blocks jsonb not null,
  created_at timestamptz not null default now()
);

create index messages_chat_id_idx on messages(chat_id);
```

- [ ] **Step 2: Apply the migration to a local/dev Supabase project**

Run: `supabase link --project-ref <your-project-ref>` (one-time, requires a Supabase project already created via the dashboard), then `supabase db push`
Expected: output confirms `0001_chats.sql` applied, no errors.

- [ ] **Step 3: Add the Supabase client and env template**

```typescript
// src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example)");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

```bash
# .env.example
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Run: `npm install @supabase/supabase-js`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_chats.sql src/lib/supabase.ts .env.example
git commit -m "feat: add Supabase chats/messages schema and client"
```

---

## Task 10: Persist chat history and reload on startup

**Files:**
- Create: `src/lib/persistChat.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/persistChat.test.ts
import { describe, it, expect, vi } from "vitest";
import { messagesToRows, rowsToMessages } from "./persistChat";
import type { Message } from "../types/message";

describe("persistChat mapping", () => {
  it("round-trips messages through the row shape unchanged", () => {
    const messages: Message[] = [
      { role: "assistant", complete: true, blocks: [{ kind: "text", text: "hello" }] },
    ];
    const chatId = "chat-1";
    const rows = messagesToRows(chatId, messages);
    expect(rows).toEqual([{ chat_id: "chat-1", role: "assistant", blocks: messages[0].blocks }]);

    const restored = rowsToMessages(rows.map((r) => ({ ...r, id: "row-1", created_at: "2026-08-04" })));
    expect(restored).toEqual(messages);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- src/lib/persistChat.test.ts`
Expected: FAIL (`./persistChat` module doesn't exist).

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/persistChat.ts
import { supabase } from "./supabase";
import type { Message, ContentBlock } from "../types/message";

export interface MessageRow {
  chat_id: string;
  role: "assistant";
  blocks: ContentBlock[];
}

export interface StoredMessageRow extends MessageRow {
  id: string;
  created_at: string;
}

export function messagesToRows(chatId: string, messages: Message[]): MessageRow[] {
  return messages
    .filter((m) => m.complete)
    .map((m) => ({ chat_id: chatId, role: m.role, blocks: m.blocks }));
}

export function rowsToMessages(rows: StoredMessageRow[]): Message[] {
  return rows.map((row) => ({ role: row.role, blocks: row.blocks, complete: true }));
}

export async function saveChatMessages(chatId: string, messages: Message[]): Promise<void> {
  const rows = messagesToRows(chatId, messages);
  if (rows.length === 0) return;
  const { error } = await supabase.from("messages").insert(rows);
  if (error) throw new Error(`failed to save messages: ${error.message}`);
}

export async function loadChatMessages(chatId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to load messages: ${error.message}`);
  return rowsToMessages((data ?? []) as StoredMessageRow[]);
}

export async function createChat(title: string | null): Promise<string> {
  const { data, error } = await supabase.from("chats").insert({ title }).select("id").single();
  if (error) throw new Error(`failed to create chat: ${error.message}`);
  return data.id as string;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- src/lib/persistChat.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire persistence into `App.tsx`** — create a chat on mount, save on each `turn_complete`, load history on startup

```tsx
// src/App.tsx — replace the previous version's body with this
import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChatView } from "./components/ChatView";
import { InputBar } from "./components/InputBar";
import { reduceEvent, type Message, type ClaudeEvent } from "./types/message";
import { createChat, loadChatMessages, saveChatMessages } from "./lib/persistChat";

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const chatIdRef = useRef<string | null>(null);

  useEffect(() => {
    createChat(null).then(async (id) => {
      chatIdRef.current = id;
      const history = await loadChatMessages(id);
      setMessages(history);
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<ClaudeEvent>("claude-event", (event) => {
      setMessages((prev) => reduceEvent(prev, event.payload));
      if (event.payload.type === "turn_complete") {
        setStreaming(false);
        setMessages((current) => {
          if (chatIdRef.current) {
            saveChatMessages(chatIdRef.current, current.slice(-1)).catch((err) =>
              console.error("failed to persist message", err)
            );
          }
          return current;
        });
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleSend = useCallback((prompt: string) => {
    setStreaming(true);
    invoke("start_session", { prompt, workingDirectory: "." }).catch((err) => {
      console.error("start_session failed", err);
      setStreaming(false);
    });
  }, []);

  return (
    <div className="app">
      <ChatView messages={messages} />
      <InputBar onSend={handleSend} disabled={streaming} />
    </div>
  );
}

export default App;
```

- [ ] **Step 6: Manually verify persistence across reload**

Run: `npm run tauri dev`, send a prompt, wait for it to complete, then quit and relaunch the app.
Expected: the completed message from before reappears on startup (loaded from Supabase), confirming the round trip works end-to-end.

- [ ] **Step 7: Commit**

```bash
git add src/lib/persistChat.ts src/lib/persistChat.test.ts src/App.tsx
git commit -m "feat: persist chat history to Supabase and reload on startup"
```

---

## Out of scope for this plan (see spec.md for later plans)

- Canvas view, frames, node-graph layout (spec §2.2)
- Human-to-human chat column, tools/logs column, teammate tabs (spec §2.1)
- Multiplayer sync (Supabase Realtime channels for presence/positions) — this plan only uses Postgres for durable history, not Realtime
- Main Agent orchestration, GitHub Actions workflow, conflict triage (spec §4)
- Cost/budget alerting (spec §5)
- Auth / room membership

## Self-Review Notes

- **Spec coverage:** This plan implements the minimum slice needed to validate "one person, one chat, streaming, persisted" — a prerequisite for every later plan (Canvas, multiplayer, Main Agent all render/orchestrate this same message stream). It does not cover spec §2–§5 features by design; see "Out of scope" above.
- **Reused from `Claude Code GUI`:** binary resolution fallback (Task 2), PTY-echo-disable fix (Task 3), stream-json flag recipe (Task 4), event taxonomy + ANSI-ignore behavior (Task 5), ordered content-block message model (Task 7), tool-call summary convention (Task 8). Explicitly not reused: any SwiftUI/AppKit code (not portable to React), context-window/usage accounting (deferred — no cost UI needed until the Main Agent plan).
- **Not reused from `VibeCo`:** confirmed via research — no PTY/CLI code, no chat UI, and its realtime layer is Liveblocks (Supabase was explicitly rejected there for a different project), so nothing in that folder applies to this foundation phase.
- **Type consistency check:** `ClaudeEvent` (Rust, Task 5) and `ClaudeEvent` (TypeScript, Task 7) are hand-mirrored, not code-generated — flagged here as a known drift risk. If a later plan adds more event variants, update both sides together, or consider `tauri-specta`/`ts-rs` for generated bindings at that point (not warranted yet for 5 variants).
