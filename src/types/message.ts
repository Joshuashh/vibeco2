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
  role: "user" | "assistant";
  blocks: ContentBlock[];
  complete: boolean;
}

export function userMessage(text: string): Message {
  return { role: "user", blocks: [{ kind: "text", text }], complete: true };
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
