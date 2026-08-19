# Preview Review Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the currently-disabled top-level "Preview" tab into a full-bleed live view of the team preview, with a floating Cursor/Pin/Draw/Comments toolbar for annotating directly over the live, hot-reloading content — no frozen snapshots, no native screen capture.

**Architecture:** Two new pure TypeScript modules (`overlayGeometry.ts` for click-to-percent math, `previewComments.ts` for types, pure filtering helpers, and thin Supabase read/write functions), three new presentational React components (`PreviewToolbar`, `PreviewAnnotationLayer`, `PreviewCommentPanel`) composed by one new page component (`PreviewPage`), and a new Supabase migration for the `preview_pins` / `preview_pin_replies` / `preview_strokes` tables. `PreviewPage` slots into `App.tsx` exactly where `CanvasView`/the chat workspace already slot in, gated by a new `"preview"` value on the existing `viewMode` state.

**Tech Stack:** React 19 + TypeScript, Supabase (Postgres + Realtime, same `postgres_changes` pattern already used for `chats`/`merge_events`), the existing Tauri `ensure_team_preview_running` command (no new Rust code — this plan is frontend-only).

---

## Before you start

Read `docs/superpowers/specs/2026-08-19-preview-review-page-design.md` in full — this plan implements it section by section. Also skim `src/components/MainAgentInstrument.tsx` (the existing `BUILD · PREVIEW` box) before starting — it already solves "start the team preview server and show its iframe," and this plan's `PreviewPage` copies that same `starting`/`ready`/`error` status pattern rather than inventing a new one.

This project's write-then-let-realtime-echo-back convention (see `decisions.md`, "Merge-orchestration leaf components call `lib/*` directly") is used throughout: every insert/update/delete in this plan is fire-and-forget from the component's perspective — local state only ever updates via the Supabase realtime subscription in `PreviewPage`, never via the write call's own return value. This avoids any duplicate-append bookkeeping.

## Task 1: `preview_pins` / `preview_pin_replies` / `preview_strokes` tables

**Files:**
- Create: `supabase/migrations/0007_preview_comments.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Preview review page (docs/superpowers/specs/2026-08-19-preview-review-page-design.md):
-- pin/reply/stroke annotations directly on the live team preview. No
-- snapshot/image table — annotations sit on the live, auto-updating iframe
-- rather than a frozen capture (see spec §2 for why). Same open-to-
-- authenticated RLS pattern as every other table in this project (no roles
-- table exists, see decisions.md).

create table preview_pins (
  id uuid primary key default gen_random_uuid(),
  x_pct real not null,
  y_pct real not null,
  text text not null,
  resolved boolean not null default false,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table preview_pin_replies (
  id uuid primary key default gen_random_uuid(),
  pin_id uuid not null references preview_pins(id) on delete cascade,
  text text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create table preview_strokes (
  id uuid primary key default gen_random_uuid(),
  path jsonb not null, -- array of {x_pct, y_pct} points
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

alter table preview_pins enable row level security;
alter table preview_pin_replies enable row level security;
alter table preview_strokes enable row level security;

create policy "preview_pins_select_all" on preview_pins
  for select to authenticated using (true);
create policy "preview_pins_insert_all" on preview_pins
  for insert to authenticated with check (true);
create policy "preview_pins_update_all" on preview_pins
  for update to authenticated using (true) with check (true);

create policy "preview_pin_replies_select_all" on preview_pin_replies
  for select to authenticated using (true);
create policy "preview_pin_replies_insert_all" on preview_pin_replies
  for insert to authenticated with check (true);

create policy "preview_strokes_select_all" on preview_strokes
  for select to authenticated using (true);
create policy "preview_strokes_insert_all" on preview_strokes
  for insert to authenticated with check (true);
create policy "preview_strokes_delete_all" on preview_strokes
  for delete to authenticated using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'preview_pins'
  ) then
    alter publication supabase_realtime add table preview_pins;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'preview_pin_replies'
  ) then
    alter publication supabase_realtime add table preview_pin_replies;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'preview_strokes'
  ) then
    alter publication supabase_realtime add table preview_strokes;
  end if;
end $$;
```

- [ ] **Step 2: Apply it to the live Supabase project**

`supabase db push` does not work in this project (see `decisions.md`) — every prior migration was applied via the Supabase MCP server's `apply_migration` tool instead. Call it with:
- `project_id`: `febfuemspzwslaujdtwc`
- `name`: `preview_comments`
- `query`: the SQL from Step 1

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0007_preview_comments.sql
git commit -m "feat: add preview_pins/preview_pin_replies/preview_strokes tables"
```

## Task 2: `overlayGeometry.ts` — click-to-percent math

**Files:**
- Create: `src/lib/overlayGeometry.ts`
- Test: `src/lib/overlayGeometry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { clientPointToPercent } from "./overlayGeometry";

function rect(overrides: Partial<DOMRect> = {}): DOMRect {
  return { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}), ...overrides } as DOMRect;
}

describe("clientPointToPercent", () => {
  it("converts a point at the container's top-left to 0,0", () => {
    expect(clientPointToPercent(0, 0, rect())).toEqual({ x_pct: 0, y_pct: 0 });
  });

  it("converts a point at the container's center to 50,50", () => {
    expect(clientPointToPercent(100, 50, rect())).toEqual({ x_pct: 50, y_pct: 50 });
  });

  it("accounts for a container offset from the viewport origin", () => {
    expect(clientPointToPercent(120, 60, rect({ left: 20, top: 10 }))).toEqual({ x_pct: 50, y_pct: 50 });
  });

  it("clamps points outside the container to 0-100", () => {
    expect(clientPointToPercent(-50, 500, rect())).toEqual({ x_pct: 0, y_pct: 100 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/overlayGeometry.test.ts`
Expected: FAIL — `overlayGeometry` module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface PercentPoint {
  x_pct: number;
  y_pct: number;
}

/** Converts a pointer event's client coordinates into a percentage position
 * (0-100) within `rect`, clamped to the container bounds — used so pins and
 * stroke points hold their on-screen spot as the preview container resizes,
 * per docs/superpowers/specs/2026-08-19-preview-review-page-design.md §2. */
export function clientPointToPercent(clientX: number, clientY: number, rect: DOMRect): PercentPoint {
  const x_pct = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
  const y_pct = clamp(((clientY - rect.top) / rect.height) * 100, 0, 100);
  return { x_pct, y_pct };
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/overlayGeometry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/overlayGeometry.ts src/lib/overlayGeometry.test.ts
git commit -m "feat: add click-to-percent conversion for preview annotations"
```

## Task 3: `previewComments.ts` — pure helpers

**Files:**
- Create: `src/lib/previewComments.ts`
- Test: `src/lib/previewComments.test.ts`

This task covers only the pure, testable pieces (types + `visiblePins`/`lastOwnStroke`/`repliesByPin`). The thin Supabase read/write wrappers are added in Task 4 without new tests, matching this codebase's existing convention (see `src/lib/mergeEvents.ts` / `mergeEvents.test.ts` — the wrapper functions there aren't tested either, only the pure logic is).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { visiblePins, lastOwnStroke, repliesByPin, type PreviewPin, type PreviewPinReply, type PreviewStroke } from "./previewComments";

function pin(overrides: Partial<PreviewPin> = {}): PreviewPin {
  return {
    id: "p1",
    x_pct: 10,
    y_pct: 10,
    text: "note",
    resolved: false,
    created_by: "u1",
    created_at: "2026-08-19T00:00:00Z",
    ...overrides,
  };
}

function stroke(overrides: Partial<PreviewStroke> = {}): PreviewStroke {
  return {
    id: "s1",
    path: [{ x_pct: 0, y_pct: 0 }],
    created_by: "u1",
    created_at: "2026-08-19T00:00:00Z",
    ...overrides,
  };
}

describe("visiblePins", () => {
  it("hides resolved pins by default", () => {
    const pins = [pin({ id: "p1", resolved: false }), pin({ id: "p2", resolved: true })];
    expect(visiblePins(pins, false)).toEqual([pins[0]]);
  });

  it("shows resolved pins when showResolved is true", () => {
    const pins = [pin({ id: "p1", resolved: false }), pin({ id: "p2", resolved: true })];
    expect(visiblePins(pins, true)).toEqual(pins);
  });
});

describe("lastOwnStroke", () => {
  it("returns null when the user has no strokes", () => {
    const strokes = [stroke({ created_by: "other" })];
    expect(lastOwnStroke(strokes, "u1")).toBeNull();
  });

  it("returns the user's most recent stroke, ignoring other users' strokes", () => {
    const strokes = [
      stroke({ id: "s1", created_by: "u1", created_at: "2026-08-19T00:00:00Z" }),
      stroke({ id: "s2", created_by: "other", created_at: "2026-08-19T00:02:00Z" }),
      stroke({ id: "s3", created_by: "u1", created_at: "2026-08-19T00:01:00Z" }),
    ];
    expect(lastOwnStroke(strokes, "u1")?.id).toBe("s3");
  });
});

describe("repliesByPin", () => {
  it("groups replies under their pin id", () => {
    const replies: PreviewPinReply[] = [
      { id: "r1", pin_id: "p1", text: "a", created_by: "u1", created_at: "2026-08-19T00:00:00Z" },
      { id: "r2", pin_id: "p2", text: "b", created_by: "u1", created_at: "2026-08-19T00:00:00Z" },
      { id: "r3", pin_id: "p1", text: "c", created_by: "u1", created_at: "2026-08-19T00:01:00Z" },
    ];
    expect(repliesByPin(replies)).toEqual({
      p1: [replies[0], replies[2]],
      p2: [replies[1]],
    });
  });

  it("returns an empty object for no replies", () => {
    expect(repliesByPin([])).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/previewComments.test.ts`
Expected: FAIL — `previewComments` module not found

- [ ] **Step 3: Write minimal implementation**

```typescript
export interface PreviewPin {
  id: string;
  x_pct: number;
  y_pct: number;
  text: string;
  resolved: boolean;
  created_by: string;
  created_at: string;
}

export interface PreviewPinReply {
  id: string;
  pin_id: string;
  text: string;
  created_by: string;
  created_at: string;
}

export interface PreviewStroke {
  id: string;
  path: { x_pct: number; y_pct: number }[];
  created_by: string;
  created_at: string;
}

/** Resolved-hide-by-default filtering for the comment panel (spec §5). */
export function visiblePins(pins: PreviewPin[], showResolved: boolean): PreviewPin[] {
  return showResolved ? pins : pins.filter((p) => !p.resolved);
}

/** Undo only ever removes the current user's own most recent stroke (spec §4). */
export function lastOwnStroke(strokes: PreviewStroke[], userId: string): PreviewStroke | null {
  const own = strokes.filter((s) => s.created_by === userId);
  if (own.length === 0) return null;
  return own.reduce((latest, s) => (s.created_at > latest.created_at ? s : latest));
}

export function repliesByPin(replies: PreviewPinReply[]): Record<string, PreviewPinReply[]> {
  const map: Record<string, PreviewPinReply[]> = {};
  for (const reply of replies) {
    (map[reply.pin_id] ??= []).push(reply);
  }
  return map;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/previewComments.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/previewComments.ts src/lib/previewComments.test.ts
git commit -m "feat: add preview comment types and filtering helpers"
```

## Task 4: `previewComments.ts` — Supabase read/write functions

**Files:**
- Modify: `src/lib/previewComments.ts`

- [ ] **Step 1: Add the Supabase wrapper functions**

Add to the top of `src/lib/previewComments.ts`:

```typescript
import { supabase } from "./supabase";
import type { PercentPoint } from "./overlayGeometry";
```

Add to the bottom of `src/lib/previewComments.ts`:

```typescript
export async function fetchPreviewPins(): Promise<PreviewPin[]> {
  const { data, error } = await supabase.from("preview_pins").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch preview pins: ${error.message}`);
  return (data ?? []) as PreviewPin[];
}

export async function fetchPreviewPinReplies(): Promise<PreviewPinReply[]> {
  const { data, error } = await supabase
    .from("preview_pin_replies")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch preview pin replies: ${error.message}`);
  return (data ?? []) as PreviewPinReply[];
}

export async function fetchPreviewStrokes(): Promise<PreviewStroke[]> {
  const { data, error } = await supabase.from("preview_strokes").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch preview strokes: ${error.message}`);
  return (data ?? []) as PreviewStroke[];
}

export async function insertPreviewPin(point: PercentPoint, text: string): Promise<void> {
  const { error } = await supabase.from("preview_pins").insert({ x_pct: point.x_pct, y_pct: point.y_pct, text });
  if (error) throw new Error(`failed to add pin: ${error.message}`);
}

export async function insertPreviewPinReply(pinId: string, text: string): Promise<void> {
  const { error } = await supabase.from("preview_pin_replies").insert({ pin_id: pinId, text });
  if (error) throw new Error(`failed to add reply: ${error.message}`);
}

export async function setPinResolved(pinId: string, resolved: boolean): Promise<void> {
  const { error } = await supabase.from("preview_pins").update({ resolved }).eq("id", pinId);
  if (error) throw new Error(`failed to update pin: ${error.message}`);
}

export async function insertPreviewStroke(path: PercentPoint[]): Promise<void> {
  const { error } = await supabase.from("preview_strokes").insert({ path });
  if (error) throw new Error(`failed to add stroke: ${error.message}`);
}

export async function deletePreviewStroke(strokeId: string): Promise<void> {
  const { error } = await supabase.from("preview_strokes").delete().eq("id", strokeId);
  if (error) throw new Error(`failed to remove stroke: ${error.message}`);
}
```

- [ ] **Step 2: Verify types check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/previewComments.ts
git commit -m "feat: add Supabase read/write functions for preview comments"
```

## Task 5: `PreviewToolbar` component

**Files:**
- Create: `src/components/PreviewToolbar.tsx`

- [ ] **Step 1: Write the component**

```tsx
export type PreviewTool = "cursor" | "pin" | "draw";

export function PreviewToolbar({
  tool,
  onToolChange,
  commentsOpen,
  onToggleComments,
  onUndo,
  canUndo,
}: {
  tool: PreviewTool;
  onToolChange: (tool: PreviewTool) => void;
  commentsOpen: boolean;
  onToggleComments: () => void;
  onUndo: () => void;
  canUndo: boolean;
}) {
  return (
    <div className="preview-toolbar">
      <button
        type="button"
        className={tool === "cursor" ? "icon-button icon-button-active" : "icon-button"}
        title="Cursor"
        onClick={() => onToolChange("cursor")}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
        </svg>
      </button>
      <button
        type="button"
        className={tool === "pin" ? "icon-button icon-button-active" : "icon-button"}
        title="Pin"
        onClick={() => onToolChange("pin")}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-7.58-7-12a7 7 0 0 1 14 0c0 4.42-7 12-7 12z" />
          <circle cx="12" cy="9" r="2.5" />
        </svg>
      </button>
      <button
        type="button"
        className={tool === "draw" ? "icon-button icon-button-active" : "icon-button"}
        title="Draw"
        onClick={() => onToolChange("draw")}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 21l3.5-1 11-11a2.12 2.12 0 0 0-3-3l-11 11z" />
        </svg>
      </button>
      {tool === "draw" && (
        <button type="button" className="icon-button" title="Undo last stroke" onClick={onUndo} disabled={!canUndo}>
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-2" />
          </svg>
        </button>
      )}
      <div className="preview-toolbar-divider" />
      <button
        type="button"
        className={commentsOpen ? "icon-button icon-button-active" : "icon-button"}
        title="Comments"
        onClick={onToggleComments}
      >
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify types check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/PreviewToolbar.tsx
git commit -m "feat: add preview page toolbar component"
```

## Task 6: `PreviewAnnotationLayer` component

**Files:**
- Create: `src/components/PreviewAnnotationLayer.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState, type PointerEvent, type RefObject } from "react";
import { clientPointToPercent, type PercentPoint } from "../lib/overlayGeometry";
import type { PreviewPin, PreviewStroke } from "../lib/previewComments";
import type { PreviewTool } from "./PreviewToolbar";

export function PreviewAnnotationLayer({
  containerRef,
  tool,
  pins,
  strokes,
  activeStroke,
  draftPin,
  onPlacePin,
  onSaveDraftPin,
  onCancelDraftPin,
  onStrokeStart,
  onStrokePoint,
  onStrokeEnd,
  onPinClick,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  tool: PreviewTool;
  pins: PreviewPin[];
  strokes: PreviewStroke[];
  activeStroke: PercentPoint[] | null;
  draftPin: PercentPoint | null;
  onPlacePin: (point: PercentPoint) => void;
  onSaveDraftPin: (text: string) => void;
  onCancelDraftPin: () => void;
  onStrokeStart: (point: PercentPoint) => void;
  onStrokePoint: (point: PercentPoint) => void;
  onStrokeEnd: () => void;
  onPinClick: (pinId: string) => void;
}) {
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftText, setDraftText] = useState("");

  function toPercent(e: PointerEvent): PercentPoint {
    const rect = containerRef.current!.getBoundingClientRect();
    return clientPointToPercent(e.clientX, e.clientY, rect);
  }

  function handlePointerDown(e: PointerEvent) {
    if (tool === "pin") {
      onPlacePin(toPercent(e));
    } else if (tool === "draw") {
      setIsDrawing(true);
      onStrokeStart(toPercent(e));
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (tool === "draw" && isDrawing) {
      onStrokePoint(toPercent(e));
    }
  }

  function handlePointerUp() {
    if (tool === "draw" && isDrawing) {
      setIsDrawing(false);
      onStrokeEnd();
    }
  }

  function toPoints(points: PercentPoint[]): string {
    return points.map((p) => `${p.x_pct},${p.y_pct}`).join(" ");
  }

  return (
    <div
      className={tool === "cursor" ? "preview-annotation-layer tool-cursor" : "preview-annotation-layer"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <svg className="preview-stroke-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        {strokes.map((stroke) => (
          <polyline key={stroke.id} points={toPoints(stroke.path)} className="preview-stroke" />
        ))}
        {activeStroke && <polyline points={toPoints(activeStroke)} className="preview-stroke preview-stroke-active" />}
      </svg>
      {pins.map((pin) => (
        <button
          key={pin.id}
          type="button"
          className={pin.resolved ? "preview-pin-marker resolved" : "preview-pin-marker"}
          style={{ left: `${pin.x_pct}%`, top: `${pin.y_pct}%` }}
          title={pin.text}
          onClick={(e) => {
            e.stopPropagation();
            onPinClick(pin.id);
          }}
        >
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 21s-7-7.58-7-12a7 7 0 0 1 14 0c0 4.42-7 12-7 12z" />
          </svg>
        </button>
      ))}
      {draftPin && (
        <div className="preview-draft-pin-form" style={{ left: `${draftPin.x_pct}%`, top: `${draftPin.y_pct}%` }}>
          <textarea
            autoFocus
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="Leave a note…"
          />
          <div className="preview-draft-pin-actions">
            <button
              type="button"
              onClick={() => {
                onSaveDraftPin(draftText);
                setDraftText("");
              }}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                onCancelDraftPin();
                setDraftText("");
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

Note: `.preview-stroke` (added in Task 9) uses `vector-effect: non-scaling-stroke` so the 0-100 percent-space viewBox doesn't distort line width when the container isn't square.

- [ ] **Step 2: Verify types check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/PreviewAnnotationLayer.tsx
git commit -m "feat: add preview annotation overlay (pins, strokes, draft pin form)"
```

## Task 7: `PreviewCommentPanel` component

**Files:**
- Create: `src/components/PreviewCommentPanel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useState } from "react";
import type { PreviewPin, PreviewPinReply } from "../lib/previewComments";

export function PreviewCommentPanel({
  pins,
  repliesByPin,
  currentUserId,
  showResolved,
  onToggleShowResolved,
  onResolve,
  onReply,
  onClose,
}: {
  pins: PreviewPin[];
  repliesByPin: Record<string, PreviewPinReply[]>;
  currentUserId: string;
  showResolved: boolean;
  onToggleShowResolved: () => void;
  onResolve: (pinId: string, resolved: boolean) => void;
  onReply: (pinId: string, text: string) => void;
  onClose: () => void;
}) {
  const sorted = [...pins].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    <div className="preview-comment-panel">
      <div className="preview-comment-panel-header">
        <span>Comments</span>
        <div className="preview-comment-panel-actions">
          <button type="button" className="pill pill-ghost" onClick={onToggleShowResolved}>
            {showResolved ? "Hide resolved" : "Show resolved"}
          </button>
          <button type="button" className="icon-button icon-button-sm" title="Close" onClick={onClose}>
            ×
          </button>
        </div>
      </div>
      <div className="preview-comment-list">
        {sorted.length === 0 && (
          <div className="preview-comment-empty">No comments yet — select Pin on the toolbar to leave one.</div>
        )}
        {sorted.map((pin) => (
          <PreviewCommentItem
            key={pin.id}
            pin={pin}
            replies={repliesByPin[pin.id] ?? []}
            currentUserId={currentUserId}
            onResolve={onResolve}
            onReply={onReply}
          />
        ))}
      </div>
    </div>
  );
}

function PreviewCommentItem({
  pin,
  replies,
  currentUserId,
  onResolve,
  onReply,
}: {
  pin: PreviewPin;
  replies: PreviewPinReply[];
  currentUserId: string;
  onResolve: (pinId: string, resolved: boolean) => void;
  onReply: (pinId: string, text: string) => void;
}) {
  const [replyText, setReplyText] = useState("");

  function submitReply() {
    if (!replyText.trim()) return;
    onReply(pin.id, replyText.trim());
    setReplyText("");
  }

  return (
    <div className={pin.resolved ? "preview-comment-item resolved" : "preview-comment-item"}>
      <div className="preview-comment-author">{pin.created_by === currentUserId ? "You" : "Teammate"}</div>
      <div className="preview-comment-text">{pin.text}</div>
      {replies.map((reply) => (
        <div key={reply.id} className="preview-comment-reply">
          <strong>{reply.created_by === currentUserId ? "You" : "Teammate"}:</strong> {reply.text}
        </div>
      ))}
      <div className="preview-comment-item-actions">
        <input
          type="text"
          placeholder="Reply…"
          value={replyText}
          onChange={(e) => setReplyText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitReply();
          }}
        />
        <button type="button" className="pill" onClick={() => onResolve(pin.id, !pin.resolved)}>
          {pin.resolved ? "Unresolve" : "Resolve"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify types check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/PreviewCommentPanel.tsx
git commit -m "feat: add preview comment panel component"
```

## Task 8: `PreviewPage` component

**Files:**
- Create: `src/components/PreviewPage.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import {
  fetchPreviewPins,
  fetchPreviewPinReplies,
  fetchPreviewStrokes,
  insertPreviewPin,
  insertPreviewPinReply,
  setPinResolved,
  insertPreviewStroke,
  deletePreviewStroke,
  lastOwnStroke,
  visiblePins,
  repliesByPin,
  type PreviewPin,
  type PreviewPinReply,
  type PreviewStroke,
} from "../lib/previewComments";
import type { PercentPoint } from "../lib/overlayGeometry";
import { PreviewToolbar, type PreviewTool } from "./PreviewToolbar";
import { PreviewAnnotationLayer } from "./PreviewAnnotationLayer";
import { PreviewCommentPanel } from "./PreviewCommentPanel";

// Same fixed port preview_server.rs always uses — see MainAgentInstrument.tsx.
const TEAM_PREVIEW_URL = "http://localhost:5180";

export function PreviewPage({ session }: { session: Session }) {
  const [previewStatus, setPreviewStatus] = useState<"starting" | "ready" | "error">("starting");
  const [tool, setTool] = useState<PreviewTool>("cursor");
  const [pins, setPins] = useState<PreviewPin[]>([]);
  const [replies, setReplies] = useState<PreviewPinReply[]>([]);
  const [strokes, setStrokes] = useState<PreviewStroke[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draftPin, setDraftPin] = useState<PercentPoint | null>(null);
  const [activeStroke, setActiveStroke] = useState<PercentPoint[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke("ensure_team_preview_running")
      .then(() => setPreviewStatus("ready"))
      .catch((err) => {
        console.error("ensure_team_preview_running failed", err);
        setPreviewStatus("error");
      });
  }, []);

  useEffect(() => {
    fetchPreviewPins().then(setPins).catch((err) => console.error("failed to fetch preview pins", err));
    fetchPreviewPinReplies()
      .then(setReplies)
      .catch((err) => console.error("failed to fetch preview pin replies", err));
    fetchPreviewStrokes().then(setStrokes).catch((err) => console.error("failed to fetch preview strokes", err));
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("preview-comments-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_pins" }, (payload) => {
        setPins((prev) => [...prev, payload.new as PreviewPin]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "preview_pins" }, (payload) => {
        const updated = payload.new as PreviewPin;
        setPins((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_pin_replies" }, (payload) => {
        setReplies((prev) => [...prev, payload.new as PreviewPinReply]);
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_strokes" }, (payload) => {
        setStrokes((prev) => [...prev, payload.new as PreviewStroke]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "preview_strokes" }, (payload) => {
        const row = payload.old as { id: string };
        setStrokes((prev) => prev.filter((s) => s.id !== row.id));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function handleSaveDraftPin(text: string) {
    if (draftPin && text.trim()) {
      insertPreviewPin(draftPin, text.trim()).catch((err) => console.error("failed to add pin", err));
      setPanelOpen(true);
    }
    setDraftPin(null);
    setTool("cursor");
  }

  function handleCancelDraftPin() {
    setDraftPin(null);
    setTool("cursor");
  }

  function handleStrokeEnd() {
    if (activeStroke && activeStroke.length >= 2) {
      insertPreviewStroke(activeStroke).catch((err) => console.error("failed to add stroke", err));
    }
    setActiveStroke(null);
  }

  function handleUndo() {
    const target = lastOwnStroke(strokes, session.user.id);
    if (target) {
      deletePreviewStroke(target.id).catch((err) => console.error("failed to undo stroke", err));
    }
  }

  return (
    <div className="preview-page">
      <div className="preview-frame-container" ref={containerRef}>
        {previewStatus === "ready" ? (
          <>
            <iframe className="preview-page-frame" src={TEAM_PREVIEW_URL} title="Live team preview" />
            <PreviewAnnotationLayer
              containerRef={containerRef}
              tool={tool}
              pins={pins}
              strokes={strokes}
              activeStroke={activeStroke}
              draftPin={draftPin}
              onPlacePin={setDraftPin}
              onSaveDraftPin={handleSaveDraftPin}
              onCancelDraftPin={handleCancelDraftPin}
              onStrokeStart={(point) => setActiveStroke([point])}
              onStrokePoint={(point) => setActiveStroke((prev) => (prev ? [...prev, point] : [point]))}
              onStrokeEnd={handleStrokeEnd}
              onPinClick={() => setPanelOpen(true)}
            />
            <PreviewToolbar
              tool={tool}
              onToolChange={setTool}
              commentsOpen={panelOpen}
              onToggleComments={() => setPanelOpen((open) => !open)}
              onUndo={handleUndo}
              canUndo={lastOwnStroke(strokes, session.user.id) !== null}
            />
          </>
        ) : (
          <div className="build-preview-empty">
            {previewStatus === "starting" ? "Starting preview…" : "Couldn't start the preview server."}
          </div>
        )}
      </div>
      {panelOpen && previewStatus === "ready" && (
        <PreviewCommentPanel
          pins={visiblePins(pins, showResolved)}
          repliesByPin={repliesByPin(replies)}
          currentUserId={session.user.id}
          showResolved={showResolved}
          onToggleShowResolved={() => setShowResolved((s) => !s)}
          onResolve={(pinId, resolved) => setPinResolved(pinId, resolved).catch((err) => console.error("failed to update pin", err))}
          onReply={(pinId, text) => insertPreviewPinReply(pinId, text).catch((err) => console.error("failed to add reply", err))}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify types check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/PreviewPage.tsx
git commit -m "feat: add PreviewPage composing toolbar, annotation layer, and comment panel"
```

## Task 9: CSS for the preview page

**Files:**
- Modify: `src/App.css`

- [ ] **Step 1: Add the styles**

Add to the end of `src/App.css`:

```css
/* ---- Preview review page (docs/superpowers/specs/2026-08-19-preview-review-page-design.md) ---- */

.preview-page {
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.preview-frame-container {
  position: relative;
  flex: 1;
  min-width: 0;
}

.preview-page-frame {
  width: 100%;
  height: 100%;
  border: none;
  display: block;
}

.preview-annotation-layer {
  position: absolute;
  inset: 0;
  cursor: crosshair;
}

.preview-annotation-layer.tool-cursor {
  pointer-events: none;
}

.preview-stroke-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.preview-stroke {
  fill: none;
  stroke: var(--accent);
  stroke-width: 2px;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
}

.preview-stroke-active {
  opacity: 0.7;
}

.preview-pin-marker {
  all: unset;
  box-sizing: border-box;
  position: absolute;
  transform: translate(-50%, -100%);
  pointer-events: auto;
  cursor: default;
  width: 22px;
  height: 22px;
  color: var(--accent);
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
}

.preview-pin-marker svg {
  width: 100%;
  height: 100%;
}

.preview-pin-marker.resolved {
  color: var(--text-tertiary);
  opacity: 0.6;
}

.preview-draft-pin-form {
  position: absolute;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 220px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
}

.preview-draft-pin-form textarea {
  resize: none;
  min-height: 60px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font: inherit;
  padding: 6px 8px;
}

.preview-draft-pin-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.preview-draft-pin-actions button {
  all: unset;
  box-sizing: border-box;
  cursor: default;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  color: var(--text-secondary);
}

.preview-draft-pin-actions button:hover {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.preview-toolbar {
  position: absolute;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  pointer-events: auto;
}

.preview-toolbar-divider {
  width: 1px;
  height: 20px;
  background: var(--border);
  margin: 0 2px;
}

.preview-comment-panel {
  width: 320px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: var(--bg-sidebar);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-comment-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75em 1em;
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--text-primary);
}

.preview-comment-panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.preview-comment-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.preview-comment-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
  margin-bottom: 8px;
  font-size: 13px;
}

.preview-comment-item.resolved {
  opacity: 0.55;
}

.preview-comment-author {
  font-size: 11px;
  color: var(--text-tertiary);
  margin-bottom: 4px;
}

.preview-comment-text {
  color: var(--text-primary);
}

.preview-comment-reply {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}

.preview-comment-item-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.preview-comment-item-actions input {
  flex: 1;
  min-width: 0;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  font: inherit;
  padding: 4px 8px;
}

.preview-comment-empty {
  color: var(--text-tertiary);
  font-size: 12px;
  padding: 1em;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/App.css
git commit -m "feat: add styles for the preview review page"
```

## Task 10: Wire the Preview tab into `ViewToggle` and `App.tsx`

**Files:**
- Modify: `src/components/ViewToggle.tsx`
- Modify: `src/App.tsx:11-12,38,224,247`

- [ ] **Step 1: Enable the Preview button**

Replace the entire contents of `src/components/ViewToggle.tsx`:

```tsx
export function ViewToggle({
  mode,
  onChange,
}: {
  mode: "chat" | "canvas" | "preview";
  onChange: (mode: "chat" | "canvas" | "preview") => void;
}) {
  return (
    <div className="view-toggle">
      {/* ponytail: no planning-mode backend yet — visual slot only, matching
          Sidebar's Projects/Skills rows. */}
      <button disabled title="Not yet available">
        Plan
      </button>
      <button className={mode === "chat" ? "active" : ""} onClick={() => onChange("chat")}>
        Chat
      </button>
      <button className={mode === "canvas" ? "active" : ""} onClick={() => onChange("canvas")}>
        Canvas
      </button>
      <button className={mode === "preview" ? "active" : ""} onClick={() => onChange("preview")}>
        Preview
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Import `PreviewPage` in `App.tsx`**

In `src/App.tsx`, add after the existing `CanvasView` import (line 12):

```typescript
import { PreviewPage } from "./components/PreviewPage";
```

- [ ] **Step 3: Widen the `viewMode` state type**

In `src/App.tsx`, replace line 38:

```typescript
  const [viewMode, setViewMode] = useState<"chat" | "canvas">("canvas");
```

with:

```typescript
  const [viewMode, setViewMode] = useState<"chat" | "canvas" | "preview">("canvas");
```

- [ ] **Step 4: Render `PreviewPage` when active**

In `src/App.tsx`, find:

```tsx
      {viewMode === "canvas" ? (
        <>
          <CanvasView
            chats={chats}
            chatStates={chatStates}
            mergeEvents={mergeEvents}
            onSend={handleSend}
            onLeave={handleLeave}
            onDelete={handleDelete}
            onExpand={handleExpand}
            onRename={handleRename}
          />
        </>
      ) : (
```

Replace it with:

```tsx
      {viewMode === "canvas" ? (
        <>
          <CanvasView
            chats={chats}
            chatStates={chatStates}
            mergeEvents={mergeEvents}
            onSend={handleSend}
            onLeave={handleLeave}
            onDelete={handleDelete}
            onExpand={handleExpand}
            onRename={handleRename}
          />
        </>
      ) : viewMode === "preview" ? (
        <PreviewPage session={session} />
      ) : (
```

- [ ] **Step 5: Verify types check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/components/ViewToggle.tsx src/App.tsx
git commit -m "feat: wire the Preview tab up to PreviewPage"
```

## Task 11: Run the full test suite and verify in the browser

**Files:** none (verification only)

- [ ] **Step 1: Run the frontend test suite**

Run: `npm test`
Expected: all suites pass, including the two new ones from Tasks 2 and 3

- [ ] **Step 2: Run the Rust test suite**

Run: `cd src-tauri && cargo test`
Expected: all 15 existing tests still pass (this plan doesn't touch Rust code, so this just confirms nothing else broke)

- [ ] **Step 3: Manually verify in the running app**

With `npx tauri dev` running, sign in, click the now-enabled **Preview** tab, and confirm:
- The live team preview loads full-bleed.
- Selecting **Pin**, clicking on the preview, typing a note, and clicking Save creates a pin and opens the comment panel.
- Selecting **Draw** and dragging draws a stroke that persists after release; **Undo** removes it.
- Clicking **Resolve** on a comment hides it from the panel by default; **Show resolved** brings it back.
- Switching back to **Cursor** lets you click through to the live app underneath.

- [ ] **Step 4: Update `decisions.md` with a short hand-off**

Note what was built, that it was verified solo (not yet with two real accounts/machines), and any rough edges found during manual verification in Step 3.
```

## Self-Review

**Spec coverage:**
- §2 (no snapshots, live annotation, position as % of container) → Tasks 2, 6, 8.
- §3 (toolbar tool selection, auto-revert after Pin, Draw stays active with Undo) → Tasks 5, 6, 8.
- §4 (data model, no snapshot table, realtime sync) → Tasks 1, 3, 4, 8.
- §5 (comment panel, resolved hidden by default with toggle) → Tasks 3, 7, 8.
- §6 (comments stay a manual log, no auto-chat-feed) → satisfied by omission — no task wires comments into chat.
- §7 (out of scope) → nothing in this plan implements any of those items.

**Placeholder scan:** no TBD/TODO; every step has complete code.

**Type consistency:** `PercentPoint` (from `overlayGeometry.ts`) is used identically as the pin/stroke-point shape across `previewComments.ts`, `PreviewAnnotationLayer.tsx`, and `PreviewPage.tsx`. `PreviewTool` is defined once in `PreviewToolbar.tsx` and imported everywhere else it's used. Function names (`visiblePins`, `lastOwnStroke`, `repliesByPin`, `insertPreviewPin`, `insertPreviewPinReply`, `setPinResolved`, `insertPreviewStroke`, `deletePreviewStroke`) match between their Task 3/4 definitions and their Task 8 call sites.
