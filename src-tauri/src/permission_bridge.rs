use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const SCRIPT_SOURCE: &str = include_str!("../permission-server/mcp-server.mjs");

/// How long a tool-call sits waiting for a human to click Allow/Deny before
/// it's treated as a denial — long enough that stepping away doesn't
/// necessarily kill the turn, short enough that an abandoned chat doesn't
/// hang the underlying `claude` process forever.
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(600);

// camelCase to match the exact keys mcp-server.mjs writes over the socket
// (`{ requestId, chatId, toolName, input }`). Without this, every request
// failed to deserialize, handle_connection bailed silently, no
// `permission-request` event was ever emitted, and `claude` hung forever
// waiting on an approval that never came — i.e. the whole Manual-mode
// permission flow was dead. The socket round-trip test missed it because it
// serialized SocketRequest with serde on both ends instead of feeding the
// real JS camelCase payload.
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SocketRequest {
    request_id: String,
    chat_id: String,
    tool_name: String,
    input: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct SocketResponse {
    decision: &'static str,
    message: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionRequestPayload {
    pub request_id: String,
    pub chat_id: String,
    pub tool_name: String,
    pub input: serde_json::Value,
}

struct Decision {
    allow: bool,
    message: Option<String>,
}

/// One global socket for the whole app (not per-chat) — every concurrent
/// chat's spawned `mcp-server.mjs` connects to the same listener and tags
/// its request with a chat_id, same pattern as the single `claude-event`
/// Tauri event carrying a chat_id for every chat already.
pub struct PermissionBridge {
    pub socket_path: PathBuf,
    pub script_path: PathBuf,
    pending: Arc<Mutex<HashMap<String, Sender<Decision>>>>,
}

impl PermissionBridge {
    /// Binds the socket and writes the embedded server script to disk once;
    /// call this exactly once at app startup and `.manage()` the result.
    pub fn start(app: AppHandle) -> Result<PermissionBridge, String> {
        let socket_path = std::env::temp_dir().join("vibeco-permission-bridge.sock");
        let _ = std::fs::remove_file(&socket_path); // stale socket from a prior crash
        let listener = UnixListener::bind(&socket_path)
            .map_err(|e| format!("failed to bind permission bridge socket: {e}"))?;

        let script_path = std::env::temp_dir().join("vibeco-permission-mcp-server.mjs");
        std::fs::write(&script_path, SCRIPT_SOURCE)
            .map_err(|e| format!("failed to write permission mcp server script: {e}"))?;

        let pending: Arc<Mutex<HashMap<String, Sender<Decision>>>> = Arc::new(Mutex::new(HashMap::new()));
        let pending_for_thread = pending.clone();

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { continue };
                let pending = pending_for_thread.clone();
                let app = app.clone();
                std::thread::spawn(move || handle_connection(stream, &pending, &app));
            }
        });

        Ok(PermissionBridge { socket_path, script_path, pending })
    }

    /// Called by the `answer_permission_request` Tauri command once the user
    /// clicks Allow/Deny in the frontend dialog.
    pub fn resolve(&self, request_id: &str, allow: bool, message: Option<String>) {
        if let Some(sender) = self.pending.lock().unwrap().remove(request_id) {
            let _ = sender.send(Decision { allow, message });
        }
    }
}

fn handle_connection(stream: UnixStream, pending: &Arc<Mutex<HashMap<String, Sender<Decision>>>>, app: &AppHandle) {
    let mut reader = BufReader::new(match stream.try_clone() {
        Ok(s) => s,
        Err(_) => return,
    });
    let mut line = String::new();
    if reader.read_line(&mut line).unwrap_or(0) == 0 {
        return;
    }
    let Ok(request) = serde_json::from_str::<SocketRequest>(line.trim()) else {
        return;
    };

    let (tx, rx) = channel();
    pending.lock().unwrap().insert(request.request_id.clone(), tx);

    let _ = app.emit(
        "permission-request",
        PermissionRequestPayload {
            request_id: request.request_id.clone(),
            chat_id: request.chat_id,
            tool_name: request.tool_name,
            input: request.input,
        },
    );

    let decision = rx.recv_timeout(APPROVAL_TIMEOUT).unwrap_or(Decision {
        allow: false,
        message: Some("Timed out waiting for approval".to_string()),
    });
    pending.lock().unwrap().remove(&request.request_id);

    let response = SocketResponse {
        decision: if decision.allow { "allow" } else { "deny" },
        message: decision.message,
    };
    let mut stream = stream;
    let _ = writeln!(stream, "{}", serde_json::to_string(&response).unwrap_or_default());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_script_is_nonempty() {
        assert!(SCRIPT_SOURCE.contains("approve_tool_use"));
    }

    /// Regression: the socket payload the node MCP server actually writes is
    /// camelCase (`{ requestId, chatId, toolName, input }` — see
    /// mcp-server.mjs). This deserializes that literal shape, catching the
    /// snake/camel mismatch that silently killed every approval request. Uses
    /// a hand-written JSON string, not serde's own Serialize output, so it
    /// tests the real JS→Rust boundary rather than a Rust round trip.
    #[test]
    fn deserializes_the_mcp_servers_camelcase_payload() {
        let payload = r#"{"requestId":"abc-1","chatId":"chat-xyz","toolName":"Write","input":{"file_path":"/tmp/x"}}"#;
        let req: SocketRequest = serde_json::from_str(payload).expect("must parse the MCP server's camelCase payload");
        assert_eq!(req.request_id, "abc-1");
        assert_eq!(req.chat_id, "chat-xyz");
        assert_eq!(req.tool_name, "Write");
        assert_eq!(req.input["file_path"], "/tmp/x");
    }

    /// End-to-end test of the actual socket protocol, without needing a
    /// Tauri AppHandle or the node script: binds a listener the same way
    /// `start` does, drives one request/response round trip directly, and
    /// confirms `resolve()` unblocks a connection waiting on `pending`.
    #[test]
    fn socket_round_trip_delivers_decision_to_waiting_connection() {
        let socket_path = std::env::temp_dir().join(format!("vibeco-perm-test-{}.sock", std::process::id()));
        let _ = std::fs::remove_file(&socket_path);
        let listener = UnixListener::bind(&socket_path).unwrap();
        let pending: Arc<Mutex<HashMap<String, Sender<Decision>>>> = Arc::new(Mutex::new(HashMap::new()));

        // Minimal stand-in for handle_connection that skips the AppHandle
        // emit (untestable without a running app) but exercises the same
        // pending-map wait/respond logic handle_connection uses.
        let pending_for_thread = pending.clone();
        let server_socket_path = socket_path.clone();
        let server = std::thread::spawn(move || {
            let (stream, _) = listener.accept().unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let request: SocketRequest = serde_json::from_str(line.trim()).unwrap();
            assert_eq!(request.tool_name, "Write");
            assert_eq!(request.chat_id, "chat-xyz");

            let (tx, rx) = channel();
            pending_for_thread.lock().unwrap().insert(request.request_id.clone(), tx);
            let decision = rx.recv_timeout(Duration::from_secs(5)).unwrap();
            let response =
                SocketResponse { decision: if decision.allow { "allow" } else { "deny" }, message: decision.message };
            let mut stream = stream;
            writeln!(stream, "{}", serde_json::to_string(&response).unwrap()).unwrap();
            let _ = std::fs::remove_file(&server_socket_path);
        });

        // Give the server a moment to reach accept() before connecting.
        std::thread::sleep(Duration::from_millis(50));

        let mut client = UnixStream::connect(&socket_path).unwrap();
        writeln!(
            client,
            "{}",
            serde_json::to_string(&SocketRequest {
                request_id: "req-1".to_string(),
                chat_id: "chat-xyz".to_string(),
                tool_name: "Write".to_string(),
                input: serde_json::json!({"file_path": "/tmp/x"}),
            })
            .unwrap()
        )
        .unwrap();

        // Simulates the frontend calling answer_permission_request — spin
        // until the server thread has registered the pending sender.
        loop {
            let mut map = pending.lock().unwrap();
            if let Some(sender) = map.remove("req-1") {
                sender.send(Decision { allow: true, message: None }).unwrap();
                break;
            }
            drop(map);
            std::thread::sleep(Duration::from_millis(10));
        }

        let mut reader = BufReader::new(&mut client);
        let mut response_line = String::new();
        reader.read_line(&mut response_line).unwrap();
        let response: serde_json::Value = serde_json::from_str(response_line.trim()).unwrap();
        assert_eq!(response["decision"], "allow");

        server.join().unwrap();
    }
}
