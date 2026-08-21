export type ClaudeEvent =
  | { type: "session_started"; session_id: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; is_error: boolean; content: string }
  | { type: "turn_complete" };

export interface Attachment {
  name: string;
  url: string;
  mimeType: string;
}

// An Attachment plus the local disk path it was also saved to (in the
// chat's own worktree), so Claude's Read tool can see it for that turn —
// the local path never gets persisted, only used to compose the prompt.
export interface SentAttachment extends Attachment {
  localPath: string;
}

export type ContentBlock =
  | { kind: "text"; text: string }
  | ({ kind: "attachment" } & Attachment)
  | {
      kind: "tool_use";
      id: string;
      name: string;
      input: unknown;
      result: { isError: boolean; content: string } | null;
    }
  | { kind: "handoff_brief"; text: string; briefKind: "handoff" | "checkpoint"; handedOffTo?: string };

export interface Message {
  role: "user" | "assistant";
  blocks: ContentBlock[];
  complete: boolean;
  // Absent only for messages built before this field existed and never
  // reloaded from Supabase — every new/persisted message carries one.
  createdAt?: string;
  // Which human sent a role:"user" message — absent for assistant messages
  // and for user messages sent before this field existed.
  authorEmail?: string;
}

export function userMessage(text: string, attachments: Attachment[] = [], authorEmail?: string): Message {
  const blocks: ContentBlock[] = [];
  if (text) blocks.push({ kind: "text", text });
  for (const attachment of attachments) blocks.push({ kind: "attachment", ...attachment });
  return { role: "user", blocks, complete: true, createdAt: new Date().toISOString(), authorEmail };
}

export function errorMessage(text: string): Message {
  return {
    role: "assistant",
    blocks: [{ kind: "text", text: `⚠️ ${text}` }],
    complete: true,
    createdAt: new Date().toISOString(),
  };
}

export function handoffBriefMessage(
  text: string,
  meta: { briefKind: "handoff" | "checkpoint"; handedOffTo?: string }
): Message {
  return {
    role: "assistant",
    blocks: [{ kind: "handoff_brief", text, ...meta }],
    complete: true,
    createdAt: new Date().toISOString(),
  };
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
    ? { role: "assistant", blocks: [], complete: false, createdAt: new Date().toISOString() }
    : openMessage;

  let blocks: ContentBlock[];
  if (event.type === "text_delta") {
    // Deltas are incremental fragments of one running text block (see
    // stream_parser.rs's content_block_delta handling) — append onto the
    // currently-open text block instead of starting a new one each time,
    // so streamed text extends in place instead of stacking as separate
    // markdown-rendered chunks.
    const last = current.blocks[current.blocks.length - 1];
    blocks =
      last?.kind === "text"
        ? [...current.blocks.slice(0, -1), { kind: "text", text: last.text + event.text }]
        : [...current.blocks, { kind: "text", text: event.text }];
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
