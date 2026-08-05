# Canvas View + Multi-Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pannable/zoomable Canvas view where every chat is a shared, claimable workspace card, plus a Chat view toggle — replacing today's single fixed chat with a multi-chat model.

**Architecture:** Chats move from owner-only rows to shared rows (open RLS, presence-based claiming via Liveblocks). React Flow (`@xyflow/react`) renders each chat as a draggable card reusing the existing `MessageBlock`/`InputBar` components. The Rust backend threads a `chat_id` through each one-shot `claude --print` invocation so events route to the right card, and now actually uses the previously-unwired `resume_session_id` so conversations stay continuous across turns and across who's holding the claim.

**Tech Stack:** React 19, TypeScript, Vite, Tauri 2 (Rust), Supabase (Postgres + Auth + Realtime), Liveblocks (`@liveblocks/client`/`react`), `@xyflow/react`, Vitest, Cargo test.

**Reference:** `docs/superpowers/specs/2026-08-05-canvas-view-design.md`

---

## Ordering note

Tasks 1–8 are backend/library/pure-logic work — each is independently testable and safe to commit even though the app as a whole won't compile end-to-end until Task 12 rewires `App.tsx`. This mirrors how the codebase already separates pure, tested logic (`reduceEvent`, `messagesToRows`) from thin, untested UI wiring (`App.tsx`, `ChatView.tsx`) — UI components in this plan are verified manually in Task 13, not with a new test framework (the repo has no React Testing Library dependency, and adding one for this scope would contradict the "no new dependency" call in the design's library discussion).

---

### Task 1: Migration — shared chats, open RLS, Realtime publication

**Files:**
- Create: `supabase/migrations/0003_shared_chats.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Shared workspace model: chats are collaborative slots people claim to work
-- in, not resources permanently owned by whoever created them.
-- See docs/superpowers/specs/2026-08-05-canvas-view-design.md §2, §3, §10.

alter table chats
  add column position_x double precision,
  add column position_y double precision,
  add column claude_session_id text;

-- Drop the owner-only policies from 0002_auth_rls.sql.
drop policy "chats_select_own" on chats;
drop policy "chats_insert_own" on chats;
drop policy "chats_update_own" on chats;
drop policy "chats_delete_own" on chats;
drop policy "messages_select_own" on messages;
drop policy "messages_insert_own" on messages;
drop policy "messages_update_own" on messages;
drop policy "messages_delete_own" on messages;

-- Open read/write to any authenticated user. Delete guardrails (confirm
-- dialog, must be unclaimed) are enforced app-side only — there is no roles
-- table yet to gate delete at the RLS level (accepted gap, spec §10).
create policy "chats_select_all" on chats
  for select to authenticated using (true);
create policy "chats_insert_all" on chats
  for insert to authenticated with check (true);
create policy "chats_update_all" on chats
  for update to authenticated using (true);
create policy "chats_delete_all" on chats
  for delete to authenticated using (true);

create policy "messages_select_all" on messages
  for select to authenticated using (true);
create policy "messages_insert_all" on messages
  for insert to authenticated with check (true);
create policy "messages_update_all" on messages
  for update to authenticated using (true);
create policy "messages_delete_all" on messages
  for delete to authenticated using (true);

-- Enable Realtime so teammates' cards live-update on completed turns
-- (idempotent — skips tables already in the publication).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'chats'
  ) then
    alter publication supabase_realtime add table chats;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
```

- [ ] **Step 2: Apply the migration to the linked Supabase project**

Run: `supabase db push`
Expected: reports `0003_shared_chats.sql` applied with no errors.

- [ ] **Step 3: Verify the new columns and policies**

Run: `supabase db execute --sql "select column_name from information_schema.columns where table_name = 'chats' order by column_name;"`
Expected output includes `claude_session_id`, `position_x`, `position_y` alongside the existing columns.

Run: `supabase db execute --sql "select policyname from pg_policies where tablename in ('chats','messages') order by policyname;"`
Expected: only the eight `*_all` policies listed above — no `*_own` policies remain.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0003_shared_chats.sql
git commit -m "feat: shared chat model — open RLS, position + session columns"
```

---

### Task 2: Rust — thread `chat_id` and `resume_session_id` through `start_session`

**Files:**
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the failing test**

Add to the bottom of `src-tauri/src/lib.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_event_serializes_with_camel_case_chat_id() {
        let event = ChatEvent {
            chat_id: "abc".to_string(),
            event: stream_parser::ClaudeEvent::TurnComplete,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["chatId"], "abc");
        assert_eq!(json["event"]["type"], "turn_complete");
    }
}
```

- [ ] **Step 2: Run test to verify it fails to compile**

Run: `cd src-tauri && cargo test chat_event_serializes`
Expected: FAIL — `ChatEvent` is not defined.

- [ ] **Step 3: Implement `ChatEvent` and thread `chat_id`/`resume_session_id`**

Replace the full contents of `src-tauri/src/lib.rs` with:

```rust
mod claude_binary;
mod claude_process;
mod stream_parser;

use serde::Serialize;
use std::io::BufRead;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatEvent {
    chat_id: String,
    event: stream_parser::ClaudeEvent,
}

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn start_session(
    app: AppHandle,
    chat_id: String,
    prompt: String,
    working_directory: String,
    resume_session_id: Option<String>,
) -> Result<(), String> {
    let claude_path =
        claude_binary::resolve_claude_binary().ok_or_else(|| "claude binary not found".to_string())?;

    let config = claude_process::SpawnConfig {
        prompt,
        model: "sonnet".to_string(),
        working_directory: std::path::PathBuf::from(working_directory),
        resume_session_id,
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
                        let chat_event = ChatEvent { chat_id: chat_id.clone(), event };
                        let _ = app.emit("claude-event", &chat_event);
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, start_session])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chat_event_serializes_with_camel_case_chat_id() {
        let event = ChatEvent {
            chat_id: "abc".to_string(),
            event: stream_parser::ClaudeEvent::TurnComplete,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["chatId"], "abc");
        assert_eq!(json["event"]["type"], "turn_complete");
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test`
Expected: PASS, including all pre-existing tests in `claude_process.rs` and `stream_parser.rs`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: thread chat_id and resume_session_id through start_session"
```

---

### Task 3: Install React Flow

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the dependency**

Run: `npm install @xyflow/react`
Expected: `package.json` gains `"@xyflow/react"` under `dependencies`.

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @xyflow/react for canvas view"
```

---

### Task 4: `ChatRow` type

**Files:**
- Create: `src/types/chat.ts`

- [ ] **Step 1: Write the type**

```ts
export interface ChatRow {
  id: string;
  title: string | null;
  user_id: string;
  position_x: number | null;
  position_y: number | null;
  claude_session_id: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors (no other file references it yet).

- [ ] **Step 3: Commit**

```bash
git add src/types/chat.ts
git commit -m "feat: add ChatRow type"
```

---

### Task 5: `persistChat.ts` — chat list, position, session id, delete

**Files:**
- Modify: `src/lib/persistChat.ts`
- Test: `src/lib/persistChat.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to the top of `src/lib/persistChat.test.ts` (after the existing imports) and append new `describe` blocks:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  messagesToRows,
  rowsToMessages,
  fetchAllChats,
  updateChatPosition,
  updateChatSessionId,
  deleteChat,
} from "./persistChat";
import type { Message } from "../types/message";
import { supabase } from "./supabase";

vi.mock("./supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

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

describe("fetchAllChats", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all chat rows ordered by created_at", async () => {
    const order = vi.fn().mockResolvedValue({ data: [{ id: "c1" }], error: null });
    const select = vi.fn().mockReturnValue({ order });
    vi.mocked(supabase.from).mockReturnValue({ select } as never);

    const result = await fetchAllChats();

    expect(supabase.from).toHaveBeenCalledWith("chats");
    expect(select).toHaveBeenCalledWith("*");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result).toEqual([{ id: "c1" }]);
  });
});

describe("updateChatPosition", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates position_x/position_y for the given chat id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    vi.mocked(supabase.from).mockReturnValue({ update } as never);

    await updateChatPosition("c1", 10, 20);

    expect(supabase.from).toHaveBeenCalledWith("chats");
    expect(update).toHaveBeenCalledWith({ position_x: 10, position_y: 20 });
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });
});

describe("updateChatSessionId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates claude_session_id for the given chat id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    vi.mocked(supabase.from).mockReturnValue({ update } as never);

    await updateChatSessionId("c1", "sess-1");

    expect(update).toHaveBeenCalledWith({ claude_session_id: "sess-1" });
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });
});

describe("deleteChat", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the chat row by id", async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const del = vi.fn().mockReturnValue({ eq });
    vi.mocked(supabase.from).mockReturnValue({ delete: del } as never);

    await deleteChat("c1");

    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("id", "c1");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- persistChat`
Expected: FAIL — `fetchAllChats`, `updateChatPosition`, `updateChatSessionId`, `deleteChat` are not exported.

- [ ] **Step 3: Implement the new functions**

Add to the bottom of `src/lib/persistChat.ts`:

```ts
import type { ChatRow } from "../types/chat";

export async function fetchAllChats(): Promise<ChatRow[]> {
  const { data, error } = await supabase.from("chats").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch chats: ${error.message}`);
  return (data ?? []) as ChatRow[];
}

export async function updateChatPosition(chatId: string, x: number, y: number): Promise<void> {
  const { error } = await supabase.from("chats").update({ position_x: x, position_y: y }).eq("id", chatId);
  if (error) throw new Error(`failed to update chat position: ${error.message}`);
}

export async function updateChatSessionId(chatId: string, sessionId: string): Promise<void> {
  const { error } = await supabase.from("chats").update({ claude_session_id: sessionId }).eq("id", chatId);
  if (error) throw new Error(`failed to update chat session id: ${error.message}`);
}

export async function deleteChat(chatId: string): Promise<void> {
  const { error } = await supabase.from("chats").delete().eq("id", chatId);
  if (error) throw new Error(`failed to delete chat: ${error.message}`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- persistChat`
Expected: PASS, all tests including the pre-existing mapping test.

- [ ] **Step 5: Commit**

```bash
git add src/lib/persistChat.ts src/lib/persistChat.test.ts
git commit -m "feat: add chat list, position, session id, delete persistence"
```

---

### Task 6: `chatStore.ts` — pure per-chat state reducers

**Files:**
- Create: `src/lib/chatStore.ts`
- Test: `src/lib/chatStore.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { applyChatEvent, applyRealtimeMessage, initChatState } from "./chatStore";

describe("applyChatEvent", () => {
  it("creates state for an unseen chat id and reduces the event into it", () => {
    const result = applyChatEvent({}, { chatId: "c1", event: { type: "text_delta", text: "hi" } });
    expect(result.c1.messages).toEqual([
      { role: "assistant", complete: false, blocks: [{ kind: "text", text: "hi" }] },
    ]);
    expect(result.c1.streaming).toBe(false);
  });

  it("clears streaming on turn_complete for that chat only", () => {
    const states = {
      c1: { messages: [{ role: "assistant" as const, complete: false, blocks: [] }], streaming: true },
      c2: { messages: [], streaming: true },
    };
    const result = applyChatEvent(states, { chatId: "c1", event: { type: "turn_complete" } });
    expect(result.c1.streaming).toBe(false);
    expect(result.c2.streaming).toBe(true);
  });

  it("leaves other chats' state untouched", () => {
    const states = { c2: initChatState([{ role: "assistant" as const, complete: true, blocks: [] }]) };
    const result = applyChatEvent(states, { chatId: "c1", event: { type: "text_delta", text: "hi" } });
    expect(result.c2).toBe(states.c2);
  });
});

describe("applyRealtimeMessage", () => {
  it("appends a completed message onto the given chat's state", () => {
    const message = { role: "assistant" as const, complete: true, blocks: [] };
    const result = applyRealtimeMessage({}, "c1", message);
    expect(result.c1.messages).toEqual([message]);
    expect(result.c1.streaming).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- chatStore`
Expected: FAIL — `./chatStore` does not exist.

- [ ] **Step 3: Implement `chatStore.ts`**

```ts
import { reduceEvent, type ClaudeEvent, type Message } from "../types/message";

export interface ChatState {
  messages: Message[];
  streaming: boolean;
}

export interface ChatEnvelope {
  chatId: string;
  event: ClaudeEvent;
}

export function initChatState(messages: Message[] = []): ChatState {
  return { messages, streaming: false };
}

export function applyChatEvent(
  states: Record<string, ChatState>,
  envelope: ChatEnvelope
): Record<string, ChatState> {
  const current = states[envelope.chatId] ?? initChatState();
  const messages = reduceEvent(current.messages, envelope.event);
  const streaming = envelope.event.type === "turn_complete" ? false : current.streaming;
  return { ...states, [envelope.chatId]: { messages, streaming } };
}

export function applyRealtimeMessage(
  states: Record<string, ChatState>,
  chatId: string,
  message: Message
): Record<string, ChatState> {
  const current = states[chatId] ?? initChatState();
  return { ...states, [chatId]: { ...current, messages: [...current.messages, message] } };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- chatStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatStore.ts src/lib/chatStore.test.ts
git commit -m "feat: add per-chat state reducers"
```

---

### Task 7: `claim.ts` — pure claim-computation logic

**Files:**
- Create: `src/lib/claim.ts`
- Test: `src/lib/claim.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { computeClaimant, isClaimedByOther } from "./claim";

describe("computeClaimant", () => {
  it("returns null when nobody has claimed the chat", () => {
    expect(computeClaimant("c1", { email: "me@x.com", claimedChatId: null }, [])).toBeNull();
  });

  it("returns self's email when self is the claimant", () => {
    const self = { email: "me@x.com", claimedChatId: "c1" };
    expect(computeClaimant("c1", self, [])).toBe("me@x.com");
  });

  it("returns another occupant's email when they hold the claim", () => {
    const others = [{ email: "them@x.com", claimedChatId: "c1" }];
    expect(computeClaimant("c1", { email: "me@x.com", claimedChatId: null }, others)).toBe("them@x.com");
  });
});

describe("isClaimedByOther", () => {
  it("is false when unclaimed", () => {
    expect(isClaimedByOther("c1", { email: "me@x.com", claimedChatId: null }, [])).toBe(false);
  });

  it("is false when self holds the claim", () => {
    const self = { email: "me@x.com", claimedChatId: "c1" };
    expect(isClaimedByOther("c1", self, [])).toBe(false);
  });

  it("is true when another occupant holds the claim", () => {
    const others = [{ email: "them@x.com", claimedChatId: "c1" }];
    expect(isClaimedByOther("c1", { email: "me@x.com", claimedChatId: null }, others)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- claim`
Expected: FAIL — `./claim` does not exist.

- [ ] **Step 3: Implement `claim.ts`**

```ts
export interface Occupant {
  email: string;
  claimedChatId: string | null;
}

export function computeClaimant(chatId: string, self: Occupant | null, others: Occupant[]): string | null {
  if (self?.claimedChatId === chatId) return self.email;
  const other = others.find((o) => o.claimedChatId === chatId);
  return other?.email ?? null;
}

export function isClaimedByOther(chatId: string, self: Occupant | null, others: Occupant[]): boolean {
  const claimant = computeClaimant(chatId, self, others);
  return claimant !== null && claimant !== self?.email;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- claim`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/claim.ts src/lib/claim.test.ts
git commit -m "feat: add presence-based claim computation"
```

---

### Task 8: `liveblocks.ts` — claim presence + position storage

**Files:**
- Modify: `src/lib/liveblocks.ts`

- [ ] **Step 1: Update Presence, add Storage, export new hooks**

Replace the full contents of `src/lib/liveblocks.ts` with:

```ts
import { createClient, LiveMap } from "@liveblocks/client";
import { createRoomContext } from "@liveblocks/react";
import { supabase } from "./supabase";

const authUrl = import.meta.env.VITE_LIVEBLOCKS_AUTH_URL;

if (!authUrl) {
  throw new Error("VITE_LIVEBLOCKS_AUTH_URL must be set (see .env.example)");
}

const client = createClient({
  authEndpoint: async (room) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    const response = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ room }),
    });
    if (!response.ok) {
      throw new Error(`liveblocks auth failed: ${response.status}`);
    }
    return await response.json();
  },
});

export const ROOM_ID = "vibeco2-global";

type Presence = {
  email: string;
  claimedChatId: string | null;
};

type Storage = {
  positions: LiveMap<string, { x: number; y: number }>;
};

export const {
  RoomProvider,
  useOthers,
  useSelf,
  useUpdateMyPresence,
  useStorage,
  useMutation,
} = createRoomContext<Presence, Storage>(client);
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: errors only in `src/App.tsx` (still passing the old `initialPresence` shape) — expected at this point in the plan, resolved in Task 12.

- [ ] **Step 3: Commit**

```bash
git add src/lib/liveblocks.ts
git commit -m "feat: add claim presence and position storage to liveblocks room"
```

---

### Task 9: `ChatCard` component

**Files:**
- Create: `src/components/ChatCard.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { MessageBlock } from "./MessageBlock";
import { InputBar } from "./InputBar";
import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";

export interface ChatCardData {
  chat: ChatRow;
  state: ChatState;
  claimant: string | null;
  isSelf: boolean;
  onSend: (chatId: string, prompt: string) => void;
  onLeave: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onExpand: (chatId: string) => void;
  [key: string]: unknown;
}

// xyflow v12's NodeProps takes the full Node type, not just the data shape.
export type ChatCardNode = Node<ChatCardData, "chatCard">;

export function ChatCard({ data }: NodeProps<ChatCardNode>) {
  const { chat, state, claimant, isSelf, onSend, onLeave, onDelete, onExpand } = data;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const claimedByOther = claimant !== null && !isSelf;

  function handleDeleteClick() {
    if (claimant) return;
    if (confirmingDelete) {
      onDelete(chat.id);
    } else {
      setConfirmingDelete(true);
    }
  }

  return (
    <div className="chat-card">
      <div className="chat-card-header">
        <span className="chat-card-title">{chat.title ?? "Untitled chat"}</span>
        <div className="chat-card-actions">
          <button onClick={() => onExpand(chat.id)}>Expand</button>
          {isSelf && <button onClick={() => onLeave(chat.id)}>Leave</button>}
          {!claimant && (
            <button onClick={handleDeleteClick}>{confirmingDelete ? "Confirm delete?" : "Delete"}</button>
          )}
        </div>
      </div>
      {claimant && <div className="chat-card-claim">{claimant} is working here</div>}
      <div className="chat-card-messages">
        {state.messages.slice(-6).map((message, i) => (
          <div key={i} className="message">
            {message.blocks.map((block, j) => (
              <MessageBlock key={j} block={block} />
            ))}
            {!message.complete && <span className="thinking-indicator">●</span>}
          </div>
        ))}
      </div>
      <InputBar onSend={(prompt) => onSend(chat.id, prompt)} disabled={claimedByOther || state.streaming} />
    </div>
  );
}
```

- [ ] **Step 2: Add card styles**

Append to `src/App.css`, before the `@media (prefers-color-scheme: dark)` block:

```css
.chat-card {
  width: 300px;
  max-height: 320px;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 0.5em;
  font-size: 0.8em;
}

.chat-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.25em;
}

.chat-card-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-card-actions {
  display: flex;
  gap: 0.25em;
}

.chat-card-actions button {
  padding: 0.2em 0.5em;
  font-size: 0.85em;
}

.chat-card-claim {
  font-size: 0.75em;
  color: #b36b00;
  margin-bottom: 0.25em;
}

.chat-card-messages {
  flex: 1;
  overflow-y: auto;
  margin-bottom: 0.25em;
}

.chat-card .input-bar textarea {
  min-height: 2.5em;
}
```

Add inside the existing `@media (prefers-color-scheme: dark)` block (after the existing `button:active` rule):

```css
  .chat-card {
    background: #1f1f1f;
    border-color: #444;
  }
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 4: Commit**

```bash
git add src/components/ChatCard.tsx src/App.css
git commit -m "feat: add ChatCard canvas node component"
```

---

### Task 10: `CanvasView` component

**Files:**
- Create: `src/components/CanvasView.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write the component**

```tsx
import { useCallback, useEffect } from "react";
import { ReactFlow, Background, useNodesState, type NodeTypes, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";
import { ChatCard, type ChatCardNode } from "./ChatCard";
import { useStorage, useMutation, useSelf, useOthers } from "../lib/liveblocks";
import { computeClaimant } from "../lib/claim";
import { updateChatPosition } from "../lib/persistChat";

const nodeTypes: NodeTypes = { chatCard: ChatCard };

interface CanvasViewProps {
  chats: ChatRow[];
  chatStates: Record<string, ChatState>;
  onSend: (chatId: string, prompt: string) => void;
  onLeave: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onExpand: (chatId: string) => void;
}

export function CanvasView({ chats, chatStates, onSend, onLeave, onDelete, onExpand }: CanvasViewProps) {
  // useStorage's selector returns the JSON view of Storage — a LiveMap
  // becomes a plain readonly Record<key, value>, not a Map (no `.get`).
  const positions = useStorage((root) => root.positions);
  const self = useSelf();
  const others = useOthers();
  const [nodes, setNodes, onNodesChange] = useNodesState<ChatCardNode>([]);

  const setPosition = useMutation(({ storage }, chatId: string, x: number, y: number) => {
    storage.get("positions").set(chatId, { x, y });
  }, []);

  // ponytail: re-syncs the full node list on every relevant change, keeping
  // each node's in-progress local position (`existing?.position`) so an
  // active local drag isn't fought. A remote drag of the SAME card from
  // another user can still jitter against your own drag — acceptable at this
  // team size; revisit with per-node reconciliation if it's ever felt.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      return chats.map((chat, index) => {
        const existing = byId.get(chat.id);
        const stored = positions?.[chat.id];
        const fallback = { x: 100 + (index % 4) * 340, y: 100 + Math.floor(index / 4) * 320 };
        const position =
          existing?.position ??
          stored ??
          (chat.position_x != null && chat.position_y != null
            ? { x: chat.position_x, y: chat.position_y }
            : fallback);
        const claimant = computeClaimant(
          chat.id,
          self ? { email: self.presence.email, claimedChatId: self.presence.claimedChatId } : null,
          others.map((o) => ({ email: o.presence.email, claimedChatId: o.presence.claimedChatId }))
        );
        return {
          id: chat.id,
          type: "chatCard",
          position,
          data: {
            chat,
            state: chatStates[chat.id] ?? { messages: [], streaming: false },
            claimant,
            isSelf: claimant === self?.presence.email,
            onSend,
            onLeave,
            onDelete,
            onExpand,
          },
        };
      });
    });
  }, [chats, chatStates, positions, self, others, onSend, onLeave, onDelete, onExpand, setNodes]);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      setPosition(node.id, node.position.x, node.position.y);
      updateChatPosition(node.id, node.position.x, node.position.y).catch((err) =>
        console.error("failed to persist chat position", err)
      );
    },
    [setPosition]
  );

  return (
    <div className="canvas-view">
      <ReactFlow
        nodes={nodes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeDragStop={handleNodeDragStop}
        fitView
      >
        <Background />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 2: Add canvas styles**

Append to `src/App.css`, before the dark-mode media block:

```css
.canvas-view {
  position: absolute;
  inset: 0;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from this file.

- [ ] **Step 4: Commit**

```bash
git add src/components/CanvasView.tsx src/App.css
git commit -m "feat: add CanvasView with React Flow"
```

---

### Task 11: `ChatSwitcher` and `ViewToggle` components

**Files:**
- Create: `src/components/ChatSwitcher.tsx`
- Create: `src/components/ViewToggle.tsx`
- Modify: `src/App.css`

- [ ] **Step 1: Write `ChatSwitcher.tsx`**

```tsx
import type { ChatRow } from "../types/chat";

export function ChatSwitcher({
  chats,
  activeChatId,
  onSelect,
}: {
  chats: ChatRow[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
}) {
  return (
    <select className="chat-switcher" value={activeChatId ?? ""} onChange={(e) => onSelect(e.target.value)}>
      {chats.length === 0 && <option value="">No chats yet</option>}
      {chats.map((chat) => (
        <option key={chat.id} value={chat.id}>
          {chat.title ?? chat.id.slice(0, 8)}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Write `ViewToggle.tsx`**

```tsx
export function ViewToggle({
  mode,
  onChange,
}: {
  mode: "chat" | "canvas";
  onChange: (mode: "chat" | "canvas") => void;
}) {
  return (
    <div className="view-toggle">
      <button className={mode === "chat" ? "active" : ""} onClick={() => onChange("chat")}>
        Chat
      </button>
      <button className={mode === "canvas" ? "active" : ""} onClick={() => onChange("canvas")}>
        Canvas
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Add styles**

Append to `src/App.css`, before the dark-mode media block:

```css
.view-toggle {
  position: absolute;
  top: 1em;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  gap: 0.5em;
}

.view-toggle button.active {
  background-color: #396cd8;
  color: white;
}

.chat-switcher,
.new-chat {
  position: absolute;
  top: 3.5em;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
}
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no new errors from these files.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatSwitcher.tsx src/components/ViewToggle.tsx src/App.css
git commit -m "feat: add ChatSwitcher and ViewToggle components"
```

---

### Task 12: Rewire `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the full contents of `src/App.tsx`**

```tsx
import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Session } from "@supabase/supabase-js";
import { LiveMap } from "@liveblocks/client";
import { ChatView } from "./components/ChatView";
import { InputBar } from "./components/InputBar";
import { LoginScreen } from "./components/LoginScreen";
import { ChatSwitcher } from "./components/ChatSwitcher";
import { ViewToggle } from "./components/ViewToggle";
import { CanvasView } from "./components/CanvasView";
import type { ChatRow } from "./types/chat";
import { applyChatEvent, applyRealtimeMessage, initChatState, type ChatEnvelope, type ChatState } from "./lib/chatStore";
import {
  createChat,
  loadChatMessages,
  fetchAllChats,
  updateChatSessionId,
  deleteChat,
  rowsToMessages,
  type StoredMessageRow,
} from "./lib/persistChat";
import { getSession, onAuthStateChange, signOut } from "./lib/auth";
import { RoomProvider, ROOM_ID, useUpdateMyPresence, useSelf, useOthers } from "./lib/liveblocks";
import { PresenceBar } from "./components/PresenceBar";
import { supabase } from "./lib/supabase";
import { isClaimedByOther } from "./lib/claim";

function AppShell({ session }: { session: Session }) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [chatStates, setChatStates] = useState<Record<string, ChatState>>({});
  const [viewMode, setViewMode] = useState<"chat" | "canvas">("canvas");
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const updateMyPresence = useUpdateMyPresence();
  const self = useSelf();
  const others = useOthers();

  useEffect(() => {
    fetchAllChats().then(async (rows) => {
      setChats(rows);
      setActiveChatId((current) => current ?? rows[0]?.id ?? null);
      const histories = await Promise.all(rows.map((row) => loadChatMessages(row.id)));
      setChatStates((current) => {
        const next = { ...current };
        rows.forEach((row, i) => {
          next[row.id] = initChatState(histories[i]);
        });
        return next;
      });
    });
  }, []);

  useEffect(() => {
    const unlisten = listen<ChatEnvelope>("claude-event", (event) => {
      setChatStates((prev) => applyChatEvent(prev, event.payload));
      if (event.payload.event.type === "session_started") {
        updateChatSessionId(event.payload.chatId, event.payload.event.session_id).catch((err) =>
          console.error("failed to persist claude session id", err)
        );
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("messages-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const row = payload.new as StoredMessageRow;
        const [message] = rowsToMessages([row]);
        setChatStates((prev) => applyRealtimeMessage(prev, row.chat_id, message));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chats" }, (payload) => {
        const row = payload.new as ChatRow;
        setChats((prev) => (prev.some((c) => c.id === row.id) ? prev : [...prev, row]));
        setChatStates((prev) => (prev[row.id] ? prev : { ...prev, [row.id]: initChatState() }));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chats" }, (payload) => {
        const row = payload.old as { id: string };
        setChats((prev) => prev.filter((c) => c.id !== row.id));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleSend = useCallback(
    (chatId: string, prompt: string) => {
      updateMyPresence({ claimedChatId: chatId });
      setChatStates((prev) => ({
        ...prev,
        [chatId]: { ...(prev[chatId] ?? initChatState()), streaming: true },
      }));
      const chat = chats.find((c) => c.id === chatId);
      invoke("start_session", {
        chatId,
        prompt,
        workingDirectory: ".",
        resumeSessionId: chat?.claude_session_id ?? null,
      }).catch((err) => {
        console.error("start_session failed", err);
        setChatStates((prev) => ({
          ...prev,
          [chatId]: { ...(prev[chatId] ?? initChatState()), streaming: false },
        }));
      });
    },
    [chats, updateMyPresence]
  );

  const handleLeave = useCallback(
    (_chatId: string) => {
      updateMyPresence({ claimedChatId: null });
    },
    [updateMyPresence]
  );

  const handleDelete = useCallback((chatId: string) => {
    deleteChat(chatId).catch((err) => console.error("failed to delete chat", err));
    setChats((prev) => prev.filter((c) => c.id !== chatId));
  }, []);

  const handleExpand = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    setViewMode("chat");
  }, []);

  const handleCreateChat = useCallback(() => {
    createChat(null).then((id) => {
      setChats((prev) => [
        ...prev,
        {
          id,
          title: null,
          user_id: session.user.id,
          position_x: null,
          position_y: null,
          claude_session_id: null,
          created_at: new Date().toISOString(),
        },
      ]);
      setChatStates((prev) => ({ ...prev, [id]: initChatState() }));
    });
  }, [session.user.id]);

  const activeState = activeChatId ? chatStates[activeChatId] : undefined;
  const activeClaimedByOther = activeChatId
    ? isClaimedByOther(
        activeChatId,
        self ? { email: self.presence.email, claimedChatId: self.presence.claimedChatId } : null,
        others.map((o) => ({ email: o.presence.email, claimedChatId: o.presence.claimedChatId }))
      )
    : false;

  return (
    <div className="app">
      <PresenceBar />
      <button className="sign-out" onClick={() => signOut()}>
        Sign out
      </button>
      <ViewToggle mode={viewMode} onChange={setViewMode} />
      {viewMode === "canvas" ? (
        <>
          <button className="new-chat" onClick={handleCreateChat}>
            + New chat
          </button>
          <CanvasView
            chats={chats}
            chatStates={chatStates}
            onSend={handleSend}
            onLeave={handleLeave}
            onDelete={handleDelete}
            onExpand={handleExpand}
          />
        </>
      ) : (
        <>
          <ChatSwitcher chats={chats} activeChatId={activeChatId} onSelect={setActiveChatId} />
          <ChatView messages={activeState?.messages ?? []} />
          <InputBar
            onSend={(prompt) => activeChatId && handleSend(activeChatId, prompt)}
            disabled={!activeChatId || activeState?.streaming === true || activeClaimedByOther}
          />
        </>
      )}
    </div>
  );
}

function App() {
  const [session, setSession] = useState<Session | null | "loading">("loading");

  useEffect(() => {
    getSession().then(setSession);
    return onAuthStateChange(setSession);
  }, []);

  if (session === "loading") return null;
  if (!session) return <LoginScreen onSignedIn={() => {}} />;

  return (
    <RoomProvider
      id={ROOM_ID}
      initialPresence={{ email: session.user.email ?? "unknown", claimedChatId: null }}
      initialStorage={{ positions: new LiveMap() }}
    >
      <AppShell session={session} />
    </RoomProvider>
  );
}

export default App;
```

- [ ] **Step 2: Export `StoredMessageRow` from `persistChat.ts` if not already exported**

Check `src/lib/persistChat.ts` — `StoredMessageRow` is already declared with `export interface`, so no change needed there.

- [ ] **Step 3: Run the full frontend test suite and type check**

Run: `npm test`
Expected: PASS, all suites (`message`, `persistChat`, `chatStore`, `claim`, `auth`).

Run: `npx tsc --noEmit`
Expected: no errors anywhere in `src/`.

- [ ] **Step 4: Run the Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire multi-chat canvas view into App"
```

---

### Task 13: Manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Build and launch the app**

```bash
pkill -f tauri-app || true
export PATH="$HOME/.cargo/bin:$PATH"
npm run tauri build -- --debug
open src-tauri/target/debug/bundle/macos/tauri-app.app
```

- [ ] **Step 2: Verify canvas view loads and chat creation works**

Sign in. Confirm Canvas view is the default. Click "+ New chat" — a new card appears. Type a message into the new card's input bar and send it — confirm the card shows streaming text/tool rows and the card becomes claimed (shows no "is working here" label since you're the claimant, and the "Leave" button appears).

- [ ] **Step 3: Verify claim gating with a second session**

Open a second, independent browser-session-equivalent for this app (a second signed-in instance, e.g. a second machine or a second OS user profile — an incognito browser tab won't apply here since this is a Tauri app, not a web app; use another physical/VM instance if available). Confirm the card claimed in Step 2 shows "X is working here" and its input bar is disabled from the second session — both on its Canvas card and if you Expand it into Chat view on the second session. Click "Leave" from the first session and confirm the second session's input becomes enabled within a few seconds (presence propagation), in both views.

- [ ] **Step 4: Verify drag persists position**

Drag a card to a new position. Reload the app (quit and relaunch). Confirm the card is still at the dragged position (Supabase snapshot persisted).

- [ ] **Step 5: Verify expand / Chat view / delete**

Click "Expand" on a card — confirm it switches to Chat view with that chat selected in the dropdown, and the dropdown lists all chats. Switch back to Canvas view. Delete an unclaimed, empty scratch chat via its card's "Delete" button (confirm the two-click confirm flow) — confirm the card disappears and does not reappear on reload.

- [ ] **Step 6: Verify multi-turn continuity**

Send a second message into an already-claimed, already-responded-to card (e.g. "what did you just do?") — confirm the response shows awareness of the prior turn (proves `resume_session_id` threading works, not just that the UI renders two turns).

- [ ] **Step 7: Write a hand-off**

Per this session's working habits, write what changed, current state, and next steps to `HANDOFF.md`, and recommend the user start a fresh session for whatever's next (frames, Main Agent, or real role-based delete permissions — see the design spec's §10 open gaps).
