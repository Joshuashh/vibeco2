# Canvas Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the remaining visual pieces of Canvas view designed in `docs/superpowers/specs/2026-08-05-canvas-completion-design.md`: proximity-based groups with grid-snap and floating labels, a Main Agent status-bar node, a fused live build-preview instrument with animated "pulse" trunk lines, and a TE-inspired visual pass — scoped to Canvas view only.

**Architecture:** Pure clustering/reconciliation logic lives in `src/lib/grouping.ts` (tested, no React/Liveblocks dependency). Group membership and labels are new Liveblocks `LiveMap`s alongside the existing `positions` map, recomputed via a `useMutation` on every drag-stop — same pattern already used for card positions. The Main Agent instrument and group labels are new React Flow node types; a new `pulse` edge type connects them, animated only when a connected chat is actively streaming. A new read-only `merge_events` Supabase table backs the Main Agent's counts and per-chat held/conflict badges — no write path yet, since the AI orchestration that would populate it is a separate, later infrastructure project (per spec.md §4 and the design spec's scoping note).

**Tech Stack:** React 19, TypeScript, `@xyflow/react` (React Flow, already a dependency), Liveblocks (`@liveblocks/client`/`react`), Supabase (Postgres + Realtime), Vitest.

---

## File structure

- `src/lib/grouping.ts` (new) — pure clustering (union-find proximity), grid-snap, and group-id reconciliation. Tested.
- `src/lib/grouping.test.ts` (new)
- `src/lib/mergeEvents.ts` (new) — fetch + pure aggregation (counts, latest-status-by-chat) over `merge_events` rows. Tested.
- `src/lib/mergeEvents.test.ts` (new)
- `src/lib/liveblocks.ts` (modify) — add `chatGroups` and `groupLabels` to `Storage`.
- `supabase/migrations/0004_merge_events.sql` (new) — read-only `merge_events` table + Realtime publication.
- `src/components/GroupLabel.tsx` (new) — React Flow node type rendering a group's floating label, click-to-rename.
- `src/components/MainAgentInstrument.tsx` (new) — React Flow node type: fused build-preview iframe + Main Agent status bar + expandable log.
- `src/components/PulseEdge.tsx` (new) — React Flow edge type: schematic step line, animated dot when `data.active`.
- `src/components/CanvasView.tsx` (modify) — compute clusters on drag-stop, snap dragged card to grid, render group/instrument nodes and pulse edges.
- `src/components/ChatCard.tsx` (modify) — held/conflict badge from merge-event status.
- `src/App.tsx` (modify) — add `chatGroups`/`groupLabels` to `initialStorage`, fetch/subscribe `merge_events`, thread props down.
- `src/App.css` (modify) — TE-inspired styling for the new canvas elements only (scoped classes, not a global theme change).
- `.env.example` (modify) — add `VITE_BUILD_PREVIEW_URL`.

---

### Task 1: Proximity clustering and grid-snap logic

**Files:**
- Create: `src/lib/grouping.ts`
- Test: `src/lib/grouping.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/grouping.test.ts
import { describe, it, expect } from "vitest";
import { clusterByProximity, snapToGrid, reconcileGroupIds } from "./grouping";

describe("clusterByProximity", () => {
  it("returns no clusters when nodes are far apart", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 1000, y: 1000 },
    ];
    expect(clusterByProximity(nodes)).toEqual([]);
  });

  it("groups two nodes within the distance threshold", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
    ];
    const clusters = clusterByProximity(nodes);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(["a", "b"]);
    expect(clusters[0].centroid).toEqual({ x: 50, y: 0 });
  });

  it("transitively merges a chain of close nodes even if the ends are far apart", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
      { id: "c", x: 200, y: 0 },
    ];
    const clusters = clusterByProximity(nodes);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].memberIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("excludes singleton nodes with no neighbor from any cluster", () => {
    const nodes = [
      { id: "a", x: 0, y: 0 },
      { id: "b", x: 100, y: 0 },
      { id: "solo", x: 5000, y: 5000 },
    ];
    const clusters = clusterByProximity(nodes);
    expect(clusters).toHaveLength(1);
    expect(clusters.flatMap((c) => c.memberIds)).not.toContain("solo");
  });
});

describe("snapToGrid", () => {
  it("rounds to the nearest grid unit", () => {
    expect(snapToGrid(107, 20)).toBe(100);
    expect(snapToGrid(113, 20)).toBe(120);
    expect(snapToGrid(0, 20)).toBe(0);
  });
});

describe("reconcileGroupIds", () => {
  it("mints a new id for a cluster with no existing group membership", () => {
    const clusters = [{ memberIds: ["a", "b"], centroid: { x: 0, y: 0 } }];
    let calls = 0;
    const makeId = () => `new-${++calls}`;
    expect(reconcileGroupIds(clusters, {}, makeId)).toEqual({ a: "new-1", b: "new-1" });
  });

  it("keeps the majority existing group id for a cluster", () => {
    const clusters = [{ memberIds: ["a", "b", "c"], centroid: { x: 0, y: 0 } }];
    const existing = { a: "group-1", b: "group-1", c: "group-2" };
    expect(reconcileGroupIds(clusters, existing, () => "unused")).toEqual({
      a: "group-1",
      b: "group-1",
      c: "group-1",
    });
  });

  it("does not assign an id to chats outside any cluster", () => {
    const clusters = [{ memberIds: ["a", "b"], centroid: { x: 0, y: 0 } }];
    const result = reconcileGroupIds(clusters, {}, () => "g1");
    expect(result).not.toHaveProperty("solo");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/grouping.test.ts`
Expected: FAIL with "Cannot find module './grouping'" (file doesn't exist yet)

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/grouping.ts
export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

export interface Cluster {
  memberIds: string[];
  centroid: { x: number; y: number };
}

// ponytail: fixed threshold rather than card-size-aware packing. Cards are
// ~300px wide; two cards dragged adjacent (edges touching, small gap) land
// well under this. Revisit if card size ever becomes configurable.
const CLUSTER_DISTANCE = 260;

export function clusterByProximity(nodes: PositionedNode[]): Cluster[] {
  const parent = new Map<string, string>();
  nodes.forEach((n) => parent.set(n.id, n.id));

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      if (Math.sqrt(dx * dx + dy * dy) <= CLUSTER_DISTANCE) {
        union(nodes[i].id, nodes[j].id);
      }
    }
  }

  const groups = new Map<string, PositionedNode[]>();
  for (const n of nodes) {
    const root = find(n.id);
    const list = groups.get(root) ?? [];
    list.push(n);
    groups.set(root, list);
  }

  return Array.from(groups.values())
    .filter((members) => members.length > 1)
    .map((members) => ({
      memberIds: members.map((m) => m.id),
      centroid: {
        x: members.reduce((sum, m) => sum + m.x, 0) / members.length,
        y: members.reduce((sum, m) => sum + m.y, 0) / members.length,
      },
    }));
}

export function snapToGrid(value: number, gridSize = 20): number {
  return Math.round(value / gridSize) * gridSize;
}

export function reconcileGroupIds(
  clusters: Cluster[],
  existingGroupIds: Record<string, string | undefined>,
  makeId: () => string = () => crypto.randomUUID()
): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const cluster of clusters) {
    const counts = new Map<string, number>();
    for (const id of cluster.memberIds) {
      const existing = existingGroupIds[id];
      if (existing) counts.set(existing, (counts.get(existing) ?? 0) + 1);
    }
    let winner: string | null = null;
    let winnerCount = 0;
    for (const [groupId, count] of counts) {
      if (count > winnerCount) {
        winner = groupId;
        winnerCount = count;
      }
    }
    const groupId = winner ?? makeId();
    for (const id of cluster.memberIds) {
      assignments[id] = groupId;
    }
  }
  return assignments;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/grouping.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/grouping.ts src/lib/grouping.test.ts
git commit -m "feat: proximity clustering and grid-snap logic for canvas groups"
```

---

### Task 2: Liveblocks storage for group membership and labels

**Files:**
- Modify: `src/lib/liveblocks.ts`
- Modify: `src/App.tsx:206-210`

- [ ] **Step 1: Add the new storage fields**

Edit `src/lib/liveblocks.ts`, replacing the `Storage` type:

```typescript
type Storage = {
  positions: LiveMap<string, { x: number; y: number }>;
  chatGroups: LiveMap<string, string>;
  groupLabels: LiveMap<string, string>;
};
```

- [ ] **Step 2: Initialize the new storage in the room provider**

Edit `src/App.tsx`, the `RoomProvider` in the `App` component:

```typescript
    <RoomProvider
      id={ROOM_ID}
      initialPresence={{ email: session.user.email ?? "unknown", claimedChatId: null }}
      initialStorage={{ positions: new LiveMap(), chatGroups: new LiveMap(), groupLabels: new LiveMap() }}
    >
```

- [ ] **Step 3: Verify the project still typechecks**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/liveblocks.ts src/App.tsx
git commit -m "feat: add chatGroups/groupLabels to Liveblocks storage"
```

---

### Task 3: `merge_events` table (read-only for now)

**Files:**
- Create: `supabase/migrations/0004_merge_events.sql`

- [ ] **Step 1: Write the migration**

```sql
-- merge_events: the Main Agent's audit trail (merged / held / conflict per
-- chat). Read-only from the app for now — the Main Agent orchestration that
-- writes these rows is a separate, later infrastructure project (spec.md §4;
-- docs/superpowers/specs/2026-08-05-canvas-completion-design.md §3, §6). The
-- table and read path are built now so the status bar and card badges have
-- something real to read once that orchestration lands.

create table merge_events (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid references chats(id) on delete set null,
  status text not null check (status in ('merged', 'held', 'conflict')),
  detail text,
  created_at timestamptz not null default now()
);

alter table merge_events enable row level security;

create policy "merge_events_select_all" on merge_events
  for select to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'merge_events'
  ) then
    alter publication supabase_realtime add table merge_events;
  end if;
end $$;
```

- [ ] **Step 2: Apply the migration to the Supabase project**

Use the Supabase MCP `apply_migration` tool (per `decisions.md` — `supabase db push` fails against this project's remote migration-history table; every prior migration here was applied this way). Name: `merge_events`, using the SQL above.

- [ ] **Step 3: Verify the table exists**

Use the Supabase MCP `list_tables` tool and confirm `merge_events` appears with RLS enabled.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0004_merge_events.sql
git commit -m "feat: add read-only merge_events table for Main Agent status"
```

---

### Task 4: Merge-events data helpers

**Files:**
- Create: `src/lib/mergeEvents.ts`
- Test: `src/lib/mergeEvents.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/mergeEvents.test.ts
import { describe, it, expect } from "vitest";
import { countByStatus, latestStatusByChat, type MergeEvent } from "./mergeEvents";

function event(overrides: Partial<MergeEvent>): MergeEvent {
  return {
    id: "e1",
    chat_id: "c1",
    status: "merged",
    detail: null,
    created_at: "2026-08-05T00:00:00Z",
    ...overrides,
  };
}

describe("countByStatus", () => {
  it("tallies events by status", () => {
    const events = [event({ status: "merged" }), event({ status: "held" }), event({ status: "merged" })];
    expect(countByStatus(events)).toEqual({ merged: 2, held: 1, conflict: 0 });
  });

  it("returns zeroes for an empty list", () => {
    expect(countByStatus([])).toEqual({ merged: 0, held: 0, conflict: 0 });
  });
});

describe("latestStatusByChat", () => {
  it("picks the most recent event per chat", () => {
    const events = [
      event({ chat_id: "c1", status: "held", created_at: "2026-08-05T00:00:00Z" }),
      event({ chat_id: "c1", status: "merged", created_at: "2026-08-05T01:00:00Z" }),
      event({ chat_id: "c2", status: "conflict", created_at: "2026-08-05T00:30:00Z" }),
    ];
    expect(latestStatusByChat(events)).toEqual({ c1: "merged", c2: "conflict" });
  });

  it("ignores events with no chat_id", () => {
    const events = [event({ chat_id: null })];
    expect(latestStatusByChat(events)).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/mergeEvents.test.ts`
Expected: FAIL with "Cannot find module './mergeEvents'"

- [ ] **Step 3: Write the implementation**

```typescript
// src/lib/mergeEvents.ts
import { supabase } from "./supabase";

export interface MergeEvent {
  id: string;
  chat_id: string | null;
  status: "merged" | "held" | "conflict";
  detail: string | null;
  created_at: string;
}

export async function fetchMergeEvents(limit = 20): Promise<MergeEvent[]> {
  const { data, error } = await supabase
    .from("merge_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`failed to fetch merge events: ${error.message}`);
  return (data ?? []) as MergeEvent[];
}

export function countByStatus(events: MergeEvent[]): { merged: number; held: number; conflict: number } {
  const counts = { merged: 0, held: 0, conflict: 0 };
  for (const e of events) counts[e.status]++;
  return counts;
}

export function latestStatusByChat(events: MergeEvent[]): Record<string, MergeEvent["status"]> {
  const latestByChat = new Map<string, MergeEvent>();
  for (const e of events) {
    if (!e.chat_id) continue;
    const current = latestByChat.get(e.chat_id);
    if (!current || e.created_at > current.created_at) latestByChat.set(e.chat_id, e);
  }
  const result: Record<string, MergeEvent["status"]> = {};
  for (const [chatId, e] of latestByChat) result[chatId] = e.status;
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/mergeEvents.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/mergeEvents.ts src/lib/mergeEvents.test.ts
git commit -m "feat: merge-events fetch and aggregation helpers"
```

---

### Task 5: Group label node and clustering wired into Canvas view

**Files:**
- Create: `src/components/GroupLabel.tsx`
- Modify: `src/components/CanvasView.tsx`

- [ ] **Step 1: Write the group label node component**

```typescript
// src/components/GroupLabel.tsx
import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";

export interface GroupLabelData {
  label: string;
  onRename: (newLabel: string) => void;
  [key: string]: unknown;
}

export type GroupLabelNode = Node<GroupLabelData, "groupLabel">;

export function GroupLabel({ data }: NodeProps<GroupLabelNode>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);

  function commit() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== data.label) data.onRename(trimmed);
    else setDraft(data.label);
  }

  if (editing) {
    return (
      <input
        className="group-label group-label-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(data.label);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div className="group-label" onClick={() => setEditing(true)}>
      {data.label}
    </div>
  );
}
```

- [ ] **Step 2: Wire clustering into `CanvasView`**

Edit `src/components/CanvasView.tsx`. This adds group-node rendering, a `recomputeGroups` mutation, and grid-snap on drag-stop. Replace the full file:

```typescript
import { useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useNodesState,
  useReactFlow,
  type NodeTypes,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";
import type { MergeEvent } from "../lib/mergeEvents";
import { ChatCard, type ChatCardNode } from "./ChatCard";
import { GroupLabel, type GroupLabelNode } from "./GroupLabel";
import { useStorage, useMutation, useSelf, useOthers } from "../lib/liveblocks";
import { computeClaimant } from "../lib/claim";
import { updateChatPosition } from "../lib/persistChat";
import { clusterByProximity, reconcileGroupIds, snapToGrid, type PositionedNode } from "../lib/grouping";
import { latestStatusByChat } from "../lib/mergeEvents";

const nodeTypes: NodeTypes = { chatCard: ChatCard, groupLabel: GroupLabel };

// New cards spawn at a fixed grid position that's frequently outside the
// current viewport (React Flow's `fitView` only runs once, on mount) —
// without this, creating a chat looks like nothing happened. Must render as
// a child of <ReactFlow> so useReactFlow resolves to its provider.
function FocusOnNewChats({ chatIds }: { chatIds: string[] }) {
  const { fitView } = useReactFlow();
  const seenIds = useRef<Set<string>>(new Set(chatIds));

  useEffect(() => {
    const newIds = chatIds.filter((id) => !seenIds.current.has(id));
    seenIds.current = new Set(chatIds);
    if (newIds.length === 0) return;
    fitView({ nodes: newIds.map((id) => ({ id })), duration: 300, maxZoom: 1 });
  }, [chatIds, fitView]);

  return null;
}

interface CanvasViewProps {
  chats: ChatRow[];
  chatStates: Record<string, ChatState>;
  mergeEvents: MergeEvent[];
  onSend: (chatId: string, prompt: string) => void;
  onLeave: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onExpand: (chatId: string) => void;
}

export function CanvasView({
  chats,
  chatStates,
  mergeEvents,
  onSend,
  onLeave,
  onDelete,
  onExpand,
}: CanvasViewProps) {
  const positions = useStorage((root) => root.positions);
  const chatGroups = useStorage((root) => root.chatGroups);
  const groupLabels = useStorage((root) => root.groupLabels);
  const self = useSelf();
  const others = useOthers();
  const [nodes, setNodes, onNodesChange] = useNodesState<ChatCardNode | GroupLabelNode>([]);
  const statusByChat = latestStatusByChat(mergeEvents);

  const setPosition = useMutation(({ storage }, chatId: string, x: number, y: number) => {
    storage.get("positions").set(chatId, { x, y });
  }, []);

  const renameGroup = useMutation(({ storage }, groupId: string, label: string) => {
    storage.get("groupLabels").set(groupId, label);
  }, []);

  const recomputeGroups = useMutation(({ storage }, positioned: PositionedNode[]) => {
    const clusters = clusterByProximity(positioned);
    const existing: Record<string, string | undefined> = {};
    storage.get("chatGroups").forEach((groupId, chatId) => {
      existing[chatId] = groupId;
    });
    const assignments = reconcileGroupIds(clusters, existing);

    const groupsMap = storage.get("chatGroups");
    const labelsMap = storage.get("groupLabels");
    for (const chatId of Array.from(groupsMap.keys())) {
      if (!assignments[chatId]) groupsMap.delete(chatId);
    }
    for (const [chatId, groupId] of Object.entries(assignments)) {
      groupsMap.set(chatId, groupId);
      if (!labelsMap.get(groupId)) labelsMap.set(groupId, "Group");
    }
  }, []);

  // ponytail: re-syncs the full node list on every relevant change, keeping
  // each node's in-progress local position (`existing?.position`) so an
  // active local drag isn't fought. A remote drag of the SAME card from
  // another user can still jitter against your own drag — acceptable at this
  // team size; revisit with per-node reconciliation if it's ever felt.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      const chatNodes: ChatCardNode[] = chats.map((chat, index) => {
        const existing = byId.get(chat.id) as ChatCardNode | undefined;
        const stored = positions?.[chat.id];
        const fallback = { x: 100 + (index % 4) * 340, y: 180 + Math.floor(index / 4) * 320 };
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
            mergeStatus: statusByChat[chat.id] ?? null,
            onSend,
            onLeave,
            onDelete,
            onExpand,
          },
        };
      });

      const groupIdToMembers = new Map<string, ChatCardNode[]>();
      for (const node of chatNodes) {
        const groupId = chatGroups?.[node.id];
        if (!groupId) continue;
        const list = groupIdToMembers.get(groupId) ?? [];
        list.push(node);
        groupIdToMembers.set(groupId, list);
      }
      const groupNodes: GroupLabelNode[] = Array.from(groupIdToMembers.entries()).map(([groupId, members]) => {
        const centroidX = members.reduce((sum, m) => sum + m.position.x, 0) / members.length;
        const minY = Math.min(...members.map((m) => m.position.y));
        return {
          id: groupId,
          type: "groupLabel",
          position: { x: centroidX, y: minY - 40 },
          draggable: false,
          selectable: false,
          data: { label: groupLabels?.[groupId] ?? "Group", onRename: (label: string) => renameGroup(groupId, label) },
        };
      });

      return [...chatNodes, ...groupNodes];
    });
  }, [chats, chatStates, positions, chatGroups, groupLabels, self, others, statusByChat, onSend, onLeave, onDelete, onExpand, setNodes, renameGroup]);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (node.type !== "chatCard") return;
      const snapped = { x: snapToGrid(node.position.x), y: snapToGrid(node.position.y) };
      setPosition(node.id, snapped.x, snapped.y);
      updateChatPosition(node.id, snapped.x, snapped.y).catch((err) =>
        console.error("failed to persist chat position", err)
      );
      const allChatNodes = nodes.filter((n): n is ChatCardNode => n.type === "chatCard");
      const positioned: PositionedNode[] = allChatNodes.map((n) => ({
        id: n.id,
        x: n.id === node.id ? snapped.x : n.position.x,
        y: n.id === node.id ? snapped.y : n.position.y,
      }));
      recomputeGroups(positioned);
    },
    [nodes, setPosition, recomputeGroups]
  );

  return (
    <div className="canvas-view">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={handleNodeDragStop}
          fitView
        >
          <Background />
          <FocusOnNewChats chatIds={chats.map((c) => c.id)} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
```

Note: `ChatCardData` in `ChatCard.tsx` gains a `mergeStatus` field in Task 8 — this file already passes it down in anticipation; it's an inert extra prop until Task 8 lands (TypeScript won't complain since `ChatCardData` has a `[key: string]: unknown` index signature).

- [ ] **Step 3: Satisfy the new required prop at the call site, then typecheck**

`CanvasViewProps.mergeEvents` is required, so `src/App.tsx`'s existing `<CanvasView>` call now fails to typecheck until it passes one. Task 8 wires the real data; for now, edit the call site to pass an empty array as a temporary literal (Task 8's Step 2 replaces this `[]` with real state):

```typescript
          <CanvasView
            chats={chats}
            chatStates={chatStates}
            mergeEvents={[]}
            onSend={handleSend}
            onLeave={handleLeave}
            onDelete={handleDelete}
            onExpand={handleExpand}
          />
```

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/GroupLabel.tsx src/components/CanvasView.tsx src/App.tsx
git commit -m "feat: proximity-based groups with grid-snap and floating labels"
```

---

### Task 6: Pulse edges connecting groups to the trunk

**Files:**
- Create: `src/components/PulseEdge.tsx`
- Modify: `src/components/CanvasView.tsx`

- [ ] **Step 1: Write the pulse edge component**

```typescript
// src/components/PulseEdge.tsx
import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";

export function PulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const active = Boolean((data as { active?: boolean } | undefined)?.active);

  return (
    <>
      <BaseEdge id={id} path={path} className={active ? "pulse-edge pulse-edge-active" : "pulse-edge"} />
      {active && (
        <circle r="3" className="pulse-dot">
          <animateMotion dur="1.2s" repeatCount="indefinite" path={path} />
        </circle>
      )}
    </>
  );
}
```

- [ ] **Step 2: Wire edges into `CanvasView`**

In `src/components/CanvasView.tsx`:

Add the import and register the edge type:

```typescript
import { PulseEdge } from "./PulseEdge";
```

```typescript
const edgeTypes = { pulse: PulseEdge };
```

Add `useEdgesState` to the `@xyflow/react` import list (alongside the existing `useNodesState`):

```typescript
  useNodesState,
  useEdgesState,
```

Inside `CanvasView`, add edge state and a computation effect (after the existing node-building `useEffect`):

```typescript
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    const groupIdToMembers = new Map<string, string[]>();
    for (const chat of chats) {
      const groupId = chatGroups?.[chat.id];
      if (!groupId) continue;
      const list = groupIdToMembers.get(groupId) ?? [];
      list.push(chat.id);
      groupIdToMembers.set(groupId, list);
    }
    const groupEdges = Array.from(groupIdToMembers.entries()).flatMap(([groupId, memberIds]) => {
      const memberEdges = memberIds.map((chatId) => ({
        id: `e-${groupId}-${chatId}`,
        source: groupId,
        target: chatId,
        type: "pulse",
        data: { active: chatStates[chatId]?.streaming ?? false },
      }));
      return memberEdges;
    });
    setEdges(groupEdges);
  }, [chats, chatGroups, chatStates, setEdges]);
```

Add the `Edge` type to the `@xyflow/react` import:

```typescript
  type Edge,
```

Pass edges to the `<ReactFlow>` element:

```typescript
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          fitView
        >
```

- [ ] **Step 3: Verify the project typechecks and builds**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/components/PulseEdge.tsx src/components/CanvasView.tsx
git commit -m "feat: animated pulse edges from active chats to their group"
```

---

### Task 7: Main Agent instrument (status bar + live build preview)

**Files:**
- Create: `src/components/MainAgentInstrument.tsx`
- Modify: `src/components/CanvasView.tsx`
- Modify: `.env.example`

- [ ] **Step 1: Add the build-preview env var**

Edit `.env.example`, appending:

```
VITE_BUILD_PREVIEW_URL=http://localhost:1420
```

- [ ] **Step 2: Write the instrument component**

```typescript
// src/components/MainAgentInstrument.tsx
import { useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import type { MergeEvent } from "../lib/mergeEvents";
import { countByStatus } from "../lib/mergeEvents";

export interface MainAgentInstrumentData {
  mergeEvents: MergeEvent[];
  refreshKey: number;
  [key: string]: unknown;
}

export type MainAgentInstrumentNode = Node<MainAgentInstrumentData, "mainAgentInstrument">;

const PREVIEW_URL = import.meta.env.VITE_BUILD_PREVIEW_URL ?? "http://localhost:1420";

export function MainAgentInstrument({ data }: NodeProps<MainAgentInstrumentNode>) {
  const [logOpen, setLogOpen] = useState(false);
  const counts = countByStatus(data.mergeEvents);

  return (
    <div className="main-agent-instrument">
      <div className="build-preview-panel">
        <div className="build-preview-header">BUILD · PREVIEW</div>
        <iframe key={data.refreshKey} className="build-preview-frame" src={PREVIEW_URL} title="Live build preview" />
      </div>
      <div className="main-agent-bar" onClick={() => setLogOpen((open) => !open)}>
        <span className="main-agent-label">⬡ MAIN AGENT</span>
        <span className="main-agent-count main-agent-count-merged">{counts.merged} merged</span>
        <span className="main-agent-count main-agent-count-held">{counts.held} held</span>
        <span className="main-agent-count main-agent-count-conflict">{counts.conflict} conflict</span>
      </div>
      {logOpen && (
        <div className="main-agent-log">
          {data.mergeEvents.length === 0 && <div className="main-agent-log-empty">No merge activity yet.</div>}
          {data.mergeEvents.map((event) => (
            <div key={event.id} className={`main-agent-log-row main-agent-log-row-${event.status}`}>
              <span>{event.status}</span>
              <span>{event.detail ?? event.chat_id ?? "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `CanvasView`**

In `src/components/CanvasView.tsx`:

Add the import and node-type registration:

```typescript
import { MainAgentInstrument, type MainAgentInstrumentNode } from "./MainAgentInstrument";
```

```typescript
const nodeTypes: NodeTypes = { chatCard: ChatCard, groupLabel: GroupLabel, mainAgentInstrument: MainAgentInstrument };
```

Update the `useNodesState` generic to include the new node type:

```typescript
  const [nodes, setNodes, onNodesChange] = useNodesState<ChatCardNode | GroupLabelNode | MainAgentInstrumentNode>([]);
```

Add a `refreshKey` that bumps whenever a new "merged" event arrives (place near the top of the component, after existing hooks):

```typescript
  const mergedCount = mergeEvents.filter((e) => e.status === "merged").length;
  const refreshKeyRef = useRef(0);
  const lastMergedCountRef = useRef(mergedCount);
  if (mergedCount !== lastMergedCountRef.current) {
    lastMergedCountRef.current = mergedCount;
    refreshKeyRef.current += 1;
  }
```

In the node-building `useEffect`, add the instrument node to the returned array (append after `groupNodes` in the final `return [...chatNodes, ...groupNodes]` line):

```typescript
      const instrumentPosition = positions?.["main-agent"] ?? { x: 260, y: -220 };
      const instrumentNode: MainAgentInstrumentNode = {
        id: "main-agent",
        type: "mainAgentInstrument",
        position: instrumentPosition,
        data: { mergeEvents, refreshKey: refreshKeyRef.current },
      };

      return [...chatNodes, ...groupNodes, instrumentNode];
```

Add `mergeEvents` to that `useEffect`'s dependency array.

Connect the instrument to each group's trunk line — in the edge-building `useEffect` from Task 6, add a trunk edge per group (extend the `groupEdges` construction):

```typescript
    const trunkEdges = Array.from(groupIdToMembers.entries()).map(([groupId, memberIds]) => ({
      id: `e-main-agent-${groupId}`,
      source: "main-agent",
      target: groupId,
      type: "pulse",
      data: { active: memberIds.some((chatId) => chatStates[chatId]?.streaming) },
    }));
    setEdges([...trunkEdges, ...groupEdges]);
```

(replacing the earlier `setEdges(groupEdges);` line)

Since the instrument now has its own draggable position (reusing the `positions` map with the fixed id `"main-agent"`), extend `handleNodeDragStop` to persist it too — change the early-return guard:

```typescript
    (_event: unknown, node: Node) => {
      if (node.type === "mainAgentInstrument") {
        setPosition(node.id, node.position.x, node.position.y);
        updateChatPosition(node.id, node.position.x, node.position.y).catch(() => {
          // ponytail: main-agent has no `chats` row, so this Supabase write
          // is expected to no-op/fail silently — Liveblocks storage (above)
          // is the real persistence for its position.
        });
        return;
      }
      if (node.type !== "chatCard") return;
```

- [ ] **Step 4: Thread `mergeEvents` through `App.tsx`**

This is completed in Task 8 (which also removes the `mergeEvents={[]}` placeholder from Task 5). For now, verify typecheck:

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/MainAgentInstrument.tsx src/components/CanvasView.tsx .env.example
git commit -m "feat: Main Agent status bar fused with live build preview"
```

---

### Task 8: Merge-event data flow and held/conflict card badges

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ChatCard.tsx`

- [ ] **Step 1: Fetch and subscribe to `merge_events` in `AppShell`**

Edit `src/App.tsx`. Add the import:

```typescript
import { fetchMergeEvents, type MergeEvent } from "./lib/mergeEvents";
```

Add state (alongside the existing `chats`/`chatStates` state declarations):

```typescript
  const [mergeEvents, setMergeEvents] = useState<MergeEvent[]>([]);
```

Add a fetch-on-mount effect (alongside the existing `fetchAllChats` effect):

```typescript
  useEffect(() => {
    fetchMergeEvents().then(setMergeEvents);
  }, []);
```

Add a Realtime subscription — extend the existing `supabase.channel("messages-live")` builder with one more `.on(...)` call, inserted before the trailing `.subscribe();`:

```typescript
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "merge_events" }, (payload) => {
        setMergeEvents((prev) => [payload.new as MergeEvent, ...prev]);
      })
```

- [ ] **Step 2: Pass `mergeEvents` into `CanvasView`, replacing the Task 5 placeholder**

Edit the `<CanvasView>` call site in `src/App.tsx`:

```typescript
          <CanvasView
            chats={chats}
            chatStates={chatStates}
            mergeEvents={mergeEvents}
            onSend={handleSend}
            onLeave={handleLeave}
            onDelete={handleDelete}
            onExpand={handleExpand}
          />
```

- [ ] **Step 3: Add the held/conflict badge to `ChatCard`**

Edit `src/components/ChatCard.tsx`. Add `mergeStatus` to the data interface:

```typescript
export interface ChatCardData {
  chat: ChatRow;
  state: ChatState;
  claimant: string | null;
  isSelf: boolean;
  mergeStatus: "merged" | "held" | "conflict" | null;
  onSend: (chatId: string, prompt: string) => void;
  onLeave: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onExpand: (chatId: string) => void;
  [key: string]: unknown;
}
```

Destructure and render the badge — update the component body:

```typescript
export function ChatCard({ data }: NodeProps<ChatCardNode>) {
  const { chat, state, claimant, isSelf, mergeStatus, onSend, onLeave, onDelete, onExpand } = data;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const claimedByOther = claimant !== null && !isSelf;
  const flagged = mergeStatus === "held" || mergeStatus === "conflict";

  function handleDeleteClick() {
    if (claimant) return;
    if (confirmingDelete) {
      onDelete(chat.id);
    } else {
      setConfirmingDelete(true);
    }
  }

  return (
    <div className={flagged ? `chat-card chat-card-${mergeStatus}` : "chat-card"}>
      <div className="chat-card-header">
        <span className="chat-card-title">{chat.title ?? "Untitled chat"}</span>
        {flagged && <span className="chat-card-badge">⚠ {mergeStatus}</span>}
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

- [ ] **Step 4: Verify everything still typechecks and all existing tests pass**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all test suites pass (existing suites plus `grouping.test.ts` and `mergeEvents.test.ts` from Tasks 1 and 4)

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/ChatCard.tsx
git commit -m "feat: wire merge-event data into Main Agent bar and chat card badges"
```

---

### Task 9: TE-inspired visual pass for the new canvas elements

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Add the styling**

Append to `src/App.css`:

```css
/* Teenage engineering-inspired direction for the canvas's group/Main Agent
   elements only — near-black surface, single accent color reserved for
   active/live state, monospace micro-labels. Scoped to these classes; the
   rest of the app (login, chat view) is untouched by this pass. */
:root {
  --te-bg: #0c0c0d;
  --te-panel: #141414;
  --te-line: #2a2a2a;
  --te-text-dim: #666;
  --te-accent: #ff5e1a;
  --te-merged: #5fd97a;
  --te-held: #e0b84a;
  --te-conflict: #e05a5a;
}

.canvas-view {
  background-color: var(--te-bg);
}

.group-label {
  font-family: "SF Mono", "JetBrains Mono", monospace;
  font-size: 0.7em;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--te-text-dim);
  background: var(--te-panel);
  border: 1px solid var(--te-line);
  border-radius: 10px;
  padding: 0.2em 0.7em;
  cursor: pointer;
  white-space: nowrap;
}

.group-label-input {
  font-family: inherit;
  font-size: inherit;
  border: 1px solid var(--te-accent);
  border-radius: 10px;
  background: var(--te-panel);
  color: #fff;
  padding: 0.2em 0.7em;
}

.main-agent-instrument {
  width: 340px;
  font-family: "SF Mono", "JetBrains Mono", monospace;
}

.build-preview-panel {
  background: var(--te-bg);
  border: 1px solid var(--te-line);
  border-bottom: none;
  resize: both;
  overflow: hidden;
  min-width: 260px;
  min-height: 180px;
  width: 340px;
  height: 220px;
  display: flex;
  flex-direction: column;
}

.build-preview-header {
  font-size: 0.65em;
  letter-spacing: 0.08em;
  color: var(--te-text-dim);
  padding: 0.4em 0.6em;
  border-bottom: 1px solid var(--te-line);
}

.build-preview-frame {
  flex: 1;
  border: none;
  width: 100%;
}

.main-agent-bar {
  background: var(--te-panel);
  border: 1px solid var(--te-accent);
  padding: 0.5em 0.7em;
  display: flex;
  gap: 0.8em;
  align-items: center;
  cursor: pointer;
  font-size: 0.7em;
}

.main-agent-label {
  color: var(--te-accent);
  letter-spacing: 0.05em;
}

.main-agent-count-merged {
  color: var(--te-merged);
}
.main-agent-count-held {
  color: var(--te-held);
}
.main-agent-count-conflict {
  color: var(--te-conflict);
}

.main-agent-log {
  background: var(--te-panel);
  border: 1px solid var(--te-line);
  border-top: none;
  max-height: 160px;
  overflow-y: auto;
  font-size: 0.65em;
}

.main-agent-log-row {
  display: flex;
  justify-content: space-between;
  padding: 0.3em 0.6em;
  border-bottom: 1px solid var(--te-line);
  color: #ccc;
}

.main-agent-log-row-merged span:first-child {
  color: var(--te-merged);
}
.main-agent-log-row-held span:first-child {
  color: var(--te-held);
}
.main-agent-log-row-conflict span:first-child {
  color: var(--te-conflict);
}

.main-agent-log-empty {
  padding: 0.5em 0.6em;
  color: var(--te-text-dim);
}

.chat-card-held,
.chat-card-conflict {
  border-width: 2px;
}
.chat-card-held {
  border-color: var(--te-held);
}
.chat-card-conflict {
  border-color: var(--te-conflict);
}

.chat-card-badge {
  font-size: 0.7em;
  padding: 0.1em 0.4em;
  border-radius: 4px;
}
.chat-card-held .chat-card-badge {
  color: var(--te-held);
}
.chat-card-conflict .chat-card-badge {
  color: var(--te-conflict);
}

.pulse-edge {
  stroke: #333;
  stroke-width: 1;
}
.pulse-edge-active {
  stroke: var(--te-accent);
}
.pulse-dot {
  fill: var(--te-accent);
}
```

- [ ] **Step 2: Verify the build still produces valid CSS**

Run: `npx tsc --noEmit && npm run build`
Expected: build succeeds

- [ ] **Step 3: Manually verify in the dev server**

Use `preview_start` with the `vite-dev` launch config (already in `.claude/launch.json`), sign in, switch to Canvas view, drag two chat cards near each other, and confirm:
- They snap into visible grid alignment and a "Group" label appears above them, editable on click
- The Main Agent instrument (preview + status bar) renders at the top with pulse edges down to the group
- Dragging a card away from the group removes it from the group (label/edge disappears for it)

- [ ] **Step 4: Commit**

```bash
git add src/App.css
git commit -m "style: teenage engineering-inspired pass for canvas groups and Main Agent"
```

---

## Out of scope (unchanged from the design spec)

- Any code that *writes* to `merge_events` (the actual Main Agent AI orchestration — a separate infrastructure project per spec.md §4).
- The human-to-human chat column and tools/logs column (still prose-only in spec.md).
- Chat view refinement.
- Exact grid-snap tolerance tuning, pulse animation timing, and the "override a held chat" interaction — flagged as open questions in the design spec's §6, left for a future pass once there's a real Main Agent to react to.
