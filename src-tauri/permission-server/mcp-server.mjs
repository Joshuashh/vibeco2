#!/usr/bin/env node
// Minimal MCP stdio server exposing exactly one tool, `approve_tool_use`,
// for use as `claude`'s `--permission-prompt-tool`. Hand-rolled JSON-RPC
// instead of pulling in @modelcontextprotocol/sdk — this only ever needs to
// answer `initialize`/`tools/list`/`tools/call`, nothing else in the MCP
// spec applies to a tool this narrow. Spawned fresh per `claude` invocation
// (see permission_bridge.rs / claude_process.rs), not a long-lived server.
//
// The actual approval decision doesn't live here: this process has no link
// to the running Vibeco window, so it forwards the request over a Unix
// socket to permission_bridge.rs (path in VIBECO_PERM_SOCKET), which emits
// it to the frontend and blocks until the user answers.
import { createConnection } from "node:net";
import { createInterface } from "node:readline";

const SOCKET_PATH = process.env.VIBECO_PERM_SOCKET;
const CHAT_ID = process.env.VIBECO_CHAT_ID || "";

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function askVibeco(toolName, input) {
  return new Promise((resolve) => {
    if (!SOCKET_PATH) {
      resolve({ decision: "deny", message: "Vibeco permission bridge not configured" });
      return;
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const socket = createConnection(SOCKET_PATH, () => {
      socket.write(JSON.stringify({ requestId, chatId: CHAT_ID, toolName, input }) + "\n");
    });
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex === -1) return;
      const line = buffer.slice(0, newlineIndex);
      socket.end();
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve({ decision: "deny", message: "Malformed response from Vibeco" });
      }
    });
    socket.on("error", () => {
      resolve({ decision: "deny", message: "Could not reach Vibeco to ask for approval" });
    });
  });
}

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", async (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }

  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "vibeco-permissions", version: "0.1.0" },
      },
    });
    return;
  }

  if (message.method === "notifications/initialized") {
    return; // notification, no response expected
  }

  if (message.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        tools: [
          {
            name: "approve_tool_use",
            description: "Asks the Vibeco desktop app to approve or deny a tool call.",
            inputSchema: {
              type: "object",
              properties: {
                tool_name: { type: "string" },
                input: { type: "object" },
              },
              required: ["tool_name", "input"],
            },
          },
        ],
      },
    });
    return;
  }

  if (message.method === "tools/call") {
    const { tool_name, input } = message.params?.arguments || {};
    const result = await askVibeco(tool_name, input);
    const permissionResult =
      result.decision === "allow"
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: result.message || "Denied by user" };
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { content: [{ type: "text", text: JSON.stringify(permissionResult) }] },
    });
    return;
  }

  if (message.id !== undefined) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Method not found: ${message.method}` },
    });
  }
});
