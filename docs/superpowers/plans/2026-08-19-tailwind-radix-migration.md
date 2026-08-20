# Tailwind + Radix/shadcn Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hand-rolled CSS (`src/App.css`, 1,663 lines) with Tailwind v4 utilities and swap custom interactive primitives for shadcn/Radix components, while refreshing the neutral color palette to the cool-neutral direction chosen in brainstorming — one component per commit, deleting each component's old CSS as it migrates.

**Architecture:** Tailwind v4's `@tailwindcss/vite` plugin runs alongside the existing `App.css` during the migration (no big-bang rewrite). A new `@theme` block maps the AC-derived palette (refreshed to cool-neutral) to Tailwind color tokens. shadcn/ui's CLI copies Radix-based component source into `src/components/ui/`. Components migrate one at a time: Tier 1 (Popover, ChatCardMenu, Sidebar delete-confirm, ViewToggle) get real Radix primitives; Tier 2 (everything else) gets a mechanical Tailwind restyle with no behavior change, in most-visible-first order.

**Tech Stack:** Tailwind CSS v4, `@tailwindcss/vite`, shadcn/ui CLI, `@radix-ui/react-popover`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-alert-dialog`, existing React 19 + Vite 7 + TypeScript + Vitest stack.

**Reference:** `docs/superpowers/specs/2026-08-19-tailwind-radix-migration-design.md` (design spec, approved).

---

## Task 1: Install Tailwind v4

**Files:**
- Modify: `package.json`, `vite.config.ts`

- [ ] **Step 1: Install Tailwind and the Vite plugin**

```bash
npm install -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 2: Add the Tailwind Vite plugin**

In `vite.config.ts`, add the import and register the plugin alongside `react()`:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
```

(Rest of the config file is unchanged — only the `plugins` array and the new import line change.)

- [ ] **Step 3: Add the Tailwind import to App.css**

At the very top of `src/App.css` (before the existing `box-sizing` reset comment), add:

```css
@import "tailwindcss";
```

- [ ] **Step 4: Verify the dev server still starts clean**

Run: `npm run dev` (or check the already-running `tauri dev` session picks it up via HMR)
Expected: no build errors in the terminal/`preview_logs`, app renders unchanged (Tailwind adds no utility classes to any markup yet, so there should be zero visual diff).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vite.config.ts src/App.css
git commit -m "build: install Tailwind v4"
```

---

## Task 2: Refresh the neutral palette and port it into a Tailwind @theme block

**Files:**
- Modify: `src/App.css:22-40` (the `:root` palette block)

- [ ] **Step 1: Replace the `:root` palette with the refreshed cool-neutral values**

In `src/App.css`, replace the existing `:root { ... }` block's color declarations (lines 22-40) with the new values — only the 12 neutral tokens change, the 6 accent/status tokens are untouched:

```css
:root {
  --bg-primary: #18191c;
  --bg-sidebar: #131417;
  --bg-secondary: #232529;
  --bg-tertiary: #2b2d33;
  --text-primary: #eef0f4;
  --text-secondary: #8d92a0;
  --text-tertiary: #63676f;
  --accent: #ed6b26;
  --accent-dim: rgba(237, 107, 38, 0.16);
  --border: #35373d;
  --user-bubble: #2a2c31;
  --send-active: #c4c8d1;
  --merged: #5fd97a;
  --held: #e8b84a;
  --conflict: #e2584f;
  --canvas-bg: #0d0e10;
  --canvas-dot: #24262b;
  --danger: #e2584f;

  font-family: -apple-system, "SF Pro Text", Inter, Avenir, Helvetica, Arial, sans-serif;
```

(Keep every non-color line inside `:root` — e.g. the `font-family` line and anything below it — exactly as it already is; only the twelve neutral hex values above change.)

- [ ] **Step 2: Add a Tailwind `@theme` block mapping the same tokens**

Directly below the `:root` block (still in `src/App.css`), add:

```css
@theme {
  --color-bg-primary: #18191c;
  --color-bg-sidebar: #131417;
  --color-bg-secondary: #232529;
  --color-bg-tertiary: #2b2d33;
  --color-text-primary: #eef0f4;
  --color-text-secondary: #8d92a0;
  --color-text-tertiary: #63676f;
  --color-accent: #ed6b26;
  --color-border: #35373d;
  --color-user-bubble: #2a2c31;
  --color-send-active: #c4c8d1;
  --color-merged: #5fd97a;
  --color-held: #e8b84a;
  --color-conflict: #e2584f;
  --color-canvas-bg: #0d0e10;
  --color-canvas-dot: #24262b;
  --color-danger: #e2584f;
}
```

This makes `bg-bg-primary`, `text-text-primary`, `border-border`, `bg-accent`, etc. available as real Tailwind utility classes in every component migrated from here on, using the same values as the `:root` custom properties above (kept separate rather than reading `var(--bg-primary)` from `@theme`, since Tailwind's `@theme` values must be static for it to generate utilities).

- [ ] **Step 3: Verify the palette shift is visible app-wide with no layout change**

Run: `npm run dev`, open the app.
Expected: sidebar/background/bubbles read as cooler blue-gray than before, the orange accent color and green/amber/red status colors are unchanged, no element moved or resized, no console errors.

- [ ] **Step 4: Run the existing test suite and type check**

```bash
npm test
npx tsc --noEmit
```

Expected: all tests pass (pure-CSS change, no logic touched), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/App.css
git commit -m "style: refresh neutral palette to cool-neutral direction, add Tailwind theme tokens"
```

---

## Task 3: Install and initialize shadcn/ui

**Files:**
- Create: `components.json`, `src/lib/utils.ts`, `src/components/ui/` (directory, populated per-component in later tasks)
- Modify: `tsconfig.json`, `vite.config.ts`

- [ ] **Step 1: Add the `@/*` path alias shadcn's CLI expects**

In `tsconfig.json`, add `baseUrl` and `paths` inside `compilerOptions` (after `"jsx": "react-jsx",`):

```json
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    },
```

- [ ] **Step 2: Add the matching alias to Vite**

In `vite.config.ts`, add a `resolve.alias` entry and the `path`/`node:url` imports it needs:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(path.dirname(fileURLToPath(import.meta.url)), "./src"),
    },
  },
```

(The rest of the `server: {...}` block below stays exactly as it is today.)

- [ ] **Step 3: Run the shadcn init CLI**

```bash
npx shadcn@latest init
```

When prompted: base color → **Neutral**, CSS variables → **yes**, Tailwind config path → confirm the auto-detected `src/App.css`, components alias → confirm `@/components`, utils alias → confirm `@/lib/utils`.

Expected output: `components.json` created at the repo root, `src/lib/utils.ts` created (the `cn()` classname-merge helper), `src/components/ui/` directory created (empty or with a couple of base files depending on CLI version).

- [ ] **Step 4: Verify shadcn's own theme additions don't fight the AC palette**

Read the new `@theme`/CSS-variable block shadcn's init added to `src/App.css` (it appends its own `--background`/`--foreground`/etc. tokens in `oklch()`). Delete that appended block — the app already has its own `--bg-*`/`--text-*` tokens from Task 2, and shadcn components will be restyled to reference those directly as each one is added (Task 4 onward), not shadcn's defaults.

- [ ] **Step 5: Verify the build is clean**

```bash
npx tsc --noEmit
npm run dev
```

Expected: no type errors, no runtime errors, app still renders identically to before this task (no component uses `@/components/ui/*` yet).

- [ ] **Step 6: Commit**

```bash
git add components.json tsconfig.json vite.config.ts src/lib/utils.ts src/components/ui src/App.css
git commit -m "build: initialize shadcn/ui"
```

---

## Task 4: Migrate Popover.tsx to Radix Popover internals

**Context:** `Popover.tsx` exports `Popover`, `PopoverHeader`, `PopoverRow`, `PopoverDivider`, consumed by `Sidebar.tsx` (the settings/sign-out menu) and `InputToolbelt.tsx` (`PermissionPill`, `ModelPicker`, `EffortPicker`). This task keeps every exported name and prop identical, so those two consumer files need **no changes** — only `Popover.tsx`'s internals move from the hand-rolled 164-line collision/flip logic to Radix's `@radix-ui/react-popover`, which already does edge-avoidance.

**Files:**
- Add dependency: `@radix-ui/react-popover`
- Modify: `src/components/Popover.tsx` (full rewrite of the `Popover` function; `PopoverHeader`/`PopoverRow`/`PopoverDivider` keep their existing JSX/props, unchanged)
- Modify: `src/App.css` (delete `.popover-menu`, `.popover-header`, `.popover-row*`, `.popover-divider` rules; add their Tailwind-class equivalents inline in the component instead)

- [ ] **Step 1: Add the dependency**

```bash
npm install @radix-ui/react-popover
```

- [ ] **Step 2: Rewrite the `Popover` component on top of Radix**

Replace the entire `Popover` function in `src/components/Popover.tsx` (lines 13-97 — the `useLayoutEffect`/`useEffect`/`createPortal` implementation) with:

```tsx
import * as RadixPopover from "@radix-ui/react-popover";
import type { RefObject } from "react";

export function Popover({
  open,
  onClose,
  anchorRef,
  width,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixPopover.Anchor virtualRef={anchorRef} />
      <RadixPopover.Portal>
        <RadixPopover.Content
          className="bg-bg-tertiary border border-border rounded-lg py-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-[100]"
          style={{ width }}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}
```

Keep the rest of the file (`PopoverHeader`, `CheckIcon`, `ChevronIcon`, `PopoverRow`, `PopoverDivider` — lines 99-165 of the original) exactly as-is; only remove the now-unused `useEffect`/`useLayoutEffect`/`useRef`/`useState`/`createPortal` imports from the top of the file since the new `Popover` no longer uses them.

- [ ] **Step 3: Delete the now-unused Popover CSS**

In `src/App.css`, delete the `.popover-menu`, `.popover-header`, `.popover-row`, `.popover-row:hover`, `.popover-row-indent`, `.popover-row-title`, `.popover-row-tint-purple`, `.popover-row-badge`, `.popover-row-spacer`, `.popover-row-check`, `.popover-row-check svg`, `.popover-row-chevron`, `.popover-row-chevron svg`, `.popover-row-shortcut`, `.popover-divider` rules (the `/* ---- Popover ... ---- */` section, originally around lines 912-1000) — but only after moving their styling into Tailwind classes on `PopoverHeader`/`PopoverRow`/`PopoverDivider`'s JSX in the same edit, e.g.:

```tsx
export function PopoverHeader({ title }: { title: string }) {
  return <div className="text-[11px] font-semibold text-text-tertiary px-3.5 pt-2.5 pb-1">{title}</div>;
}
```

Apply the same pattern (read each deleted rule's declarations, translate to the matching Tailwind utility classes) to `PopoverRow` and `PopoverDivider`'s JSX before removing their CSS rules, so no visual regression occurs.

- [ ] **Step 4: Verify both consumers still work with zero changes**

Run: `npm run dev`, open the app. Click the Sidebar gear icon (sign-out menu) and the input bar's Model/Effort/Permission pills.
Expected: all three menus open, position correctly (including near screen edges — resize the window small to confirm collision handling still works), and visually match the pre-migration screenshot (same colors, spacing, hover states). No changes needed in `Sidebar.tsx` or `InputToolbelt.tsx`.

- [ ] **Step 5: Run tests and type check**

```bash
npm test
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/components/Popover.tsx src/App.css
git commit -m "refactor: migrate Popover to Radix Popover internals"
```

---

## Task 5: Migrate ChatCardMenu.tsx to shadcn DropdownMenu, add delete confirmation

**Context:** `ChatCardMenu.tsx` is a fully hand-rolled dropdown (no Radix), used by `ChatCard.tsx` (canvas cards, no `onDelete` passed) and `ChatView.tsx` (chat header, `onDelete` passed). Its Delete button currently calls `onDelete()` immediately with **no confirmation** — a real gap for a destructive action. This task both migrates the dropdown mechanism to shadcn's `DropdownMenu` and adds a shadcn `AlertDialog` confirmation before delete fires, gated on `onDelete` being present exactly as today (so `ChatCard.tsx`'s canvas usage, which never passes `onDelete`, is unaffected).

**Files:**
- Add via shadcn CLI: `src/components/ui/dropdown-menu.tsx`, `src/components/ui/alert-dialog.tsx`
- Modify: `src/components/ChatCardMenu.tsx` (full rewrite)
- Modify: `src/App.css` (delete `.chat-card-menu`, `.chat-card-menu-dropdown*`, `.chat-card-rename-input` rules used only by this component — but check Task 6 first, since `Sidebar.tsx`'s `SidebarRow` has its own separate copy of `.chat-card-menu`/`.chat-card-menu-dropdown`/`.chat-card-rename-input` classes; don't delete those rules until Task 6 also migrates off them)

- [ ] **Step 1: Add the shadcn components**

```bash
npx shadcn@latest add dropdown-menu alert-dialog
```

Expected: `src/components/ui/dropdown-menu.tsx` and `src/components/ui/alert-dialog.tsx` created.

- [ ] **Step 2: Rewrite ChatCardMenu.tsx**

Replace the full contents of `src/components/ChatCardMenu.tsx` with:

```tsx
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function ChatCardMenu({
  title,
  onRename,
  onDelete,
}: {
  title: string;
  onRename: (newTitle: string) => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(title);

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== title) onRename(trimmed);
    setRenaming(false);
    setOpen(false);
  }

  if (renaming) {
    return (
      <input
        className="chat-card-rename-input"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitRename();
          if (e.key === "Escape") setRenaming(false);
        }}
        onBlur={commitRename}
      />
    );
  }

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="icon-button"
            title="Chat settings"
            onClick={() => setDraft(title)}
          >
            <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
          {/* ponytail: no branching/fork concept in Vibeco2 yet — visual only, per explicit request to keep the slot even though it's a no-op */}
          <DropdownMenuItem disabled>Fork conversation</DropdownMenuItem>
          {/* ponytail: no archived flag on chats yet — visual only */}
          <DropdownMenuItem disabled>Archive</DropdownMenuItem>
          {onDelete && (
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => setConfirmingDelete(true)}
            >
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {onDelete && (
        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{title}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the chat and its message history. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
```

- [ ] **Step 3: Verify in both consumers**

Run: `npm run dev`. Open a chat via `ChatView.tsx` (chat header menu) — click ⋯ → Delete → confirm the `AlertDialog` appears with the chat's title, Cancel closes it with nothing deleted, Delete removes the chat. Then check a canvas card via `ChatCard.tsx` — its ⋯ menu should show Rename/Fork/Archive with **no** Delete row (since `ChatCard.tsx` never passes `onDelete`), matching today's behavior exactly.

- [ ] **Step 4: Run tests and type check**

```bash
npm test
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/components/ChatCardMenu.tsx src/components/ui/dropdown-menu.tsx src/components/ui/alert-dialog.tsx
git commit -m "refactor: migrate ChatCardMenu to shadcn DropdownMenu, add delete confirmation"
```

---

## Task 6: Add delete confirmation to Sidebar's chat row menu, migrate its dropdown to shadcn

**Context:** `Sidebar.tsx`'s `SidebarRow` (lines 65-138) duplicates `ChatCardMenu`'s old hand-rolled dropdown pattern independently (own `open`/`renaming` state, own JSX), and its Delete button also fires with **no confirmation** today. This task applies the same shadcn `DropdownMenu` + `AlertDialog` pattern from Task 5 to `SidebarRow` specifically (not a shared component — `SidebarRow` has no Fork/Archive rows and uses `icon-button-sm`, so it stays its own small implementation rather than forcing reuse of `ChatCardMenu`, which would drag in rows Sidebar doesn't want).

**Files:**
- Modify: `src/components/Sidebar.tsx` (rewrite `SidebarRow`, lines 65-138)
- Modify: `src/App.css` (now safe to delete `.chat-card-menu`, `.chat-card-menu-dropdown*`, `.chat-card-rename-input` — both consumers have migrated off them after this task)

- [ ] **Step 1: Rewrite `SidebarRow` in `src/components/Sidebar.tsx`**

Replace the `SidebarRow` function (lines 65-138) with:

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

function SidebarRow({
  chat,
  isActive,
  onSelect,
  onRename,
  onDelete,
}: {
  chat: ChatRow;
  isActive: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(chat.title ?? "");

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed) onRename(trimmed);
    setRenaming(false);
    setOpen(false);
  }

  return (
    <div className={isActive ? "sidebar-row sidebar-row-active" : "sidebar-row"} onClick={onSelect}>
      {renaming ? (
        <input
          className="chat-card-rename-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          onBlur={commitRename}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="sidebar-row-title">{chat.title ?? "Untitled chat"}</span>
      )}
      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="icon-button icon-button-sm"
              title="Chat options"
              onClick={() => setDraft(chat.title ?? "")}
            >
              <DotsIcon />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>Rename</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setConfirmingDelete(true)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{chat.title ?? "Untitled chat"}"?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently deletes the chat and its message history. This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
```

(The `import { useMemo, useRef, useState } from "react";` line at the top of the file already covers `useState`; add the two new `@/components/ui/*` imports above it.)

- [ ] **Step 2: Delete the now-fully-unused chat-card-menu CSS**

In `src/App.css`, delete `.chat-card-menu`, `.chat-card-menu-dropdown`, `.chat-card-menu-dropdown button`, `.chat-card-menu-dropdown button:hover`, `.chat-card-menu-dropdown button:disabled`, `.chat-card-menu-dropdown button:disabled:hover`, `.chat-card-menu-dropdown button.destructive`, and `.chat-card-rename-input` (originally around lines 864-909 and 1004-1009) — **except** keep `.chat-card-rename-input` itself, since both `ChatCardMenu.tsx` (Task 5) and this file's rewritten `SidebarRow` still use that class for the inline rename `<input>`, and it was never part of the dropdown chrome being replaced.

- [ ] **Step 3: Verify**

Run: `npm run dev`. In the Sidebar, click a chat row's ⋯ → Delete → confirm the `AlertDialog` appears, Cancel/Delete both work as expected. Rename still works (Enter commits, Escape cancels, blur commits).

- [ ] **Step 4: Run tests and type check**

```bash
npm test
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/App.css
git commit -m "refactor: migrate Sidebar chat row menu to shadcn, add delete confirmation"
```

---

## Task 7: Restyle ViewToggle.tsx with Tailwind utilities

**Context:** Per the design spec, `ViewToggle` is a plain controlled segmented-button component whose content panels render elsewhere — it does **not** become a Radix `Tabs.Root`. This task only converts its markup from `App.css` classes to Tailwind utility classes; behavior (disabled Plan button, active-state highlighting) is unchanged.

**Files:**
- Modify: `src/components/ViewToggle.tsx` (full rewrite)
- Modify: `src/App.css` (delete `.view-toggle` and its child rules)

- [ ] **Step 1: Rewrite ViewToggle.tsx**

Replace the full contents of `src/components/ViewToggle.tsx` with:

```tsx
export function ViewToggle({
  mode,
  onChange,
}: {
  mode: "chat" | "canvas" | "preview";
  onChange: (mode: "chat" | "canvas" | "preview") => void;
}) {
  const base =
    "border-none bg-transparent text-text-secondary text-[0.85em] font-medium px-[1.1em] py-[0.5em] rounded-md";
  const active = "bg-bg-primary text-text-primary";
  const disabled = "text-text-tertiary opacity-60";

  return (
    <div className="flex gap-[0.2em] bg-bg-tertiary rounded-lg p-[3px]">
      {/* ponytail: no planning-mode backend yet — visual slot only, matching
          Sidebar's Projects/Skills rows. */}
      <button className={`${base} ${disabled}`} disabled title="Not yet available">
        Plan
      </button>
      <button className={mode === "chat" ? `${base} ${active}` : base} onClick={() => onChange("chat")}>
        Chat
      </button>
      <button className={mode === "canvas" ? `${base} ${active}` : base} onClick={() => onChange("canvas")}>
        Canvas
      </button>
      <button className={mode === "preview" ? `${base} ${active}` : base} onClick={() => onChange("preview")}>
        Preview
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Delete the now-unused view-toggle CSS**

In `src/App.css`, delete `.view-toggle`, `.view-toggle button`, `.view-toggle button:hover`, `.view-toggle button.active`, `.view-toggle button:disabled` (originally around lines 251-282).

- [ ] **Step 3: Verify**

Run: `npm run dev`. Confirm the toolbar's Plan/Chat/Canvas/Preview control looks pixel-identical to before (segmented pill, same padding/radius/colors), Plan stays disabled, clicking Chat/Canvas/Preview switches views and highlights the active one.

- [ ] **Step 4: Run tests and type check**

```bash
npm test
npx tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/ViewToggle.tsx src/App.css
git commit -m "style: restyle ViewToggle with Tailwind utilities"
```

---

## Task 8+: Tier 2 restyle recipe (repeat per component)

**Context:** Tier 1 is done — Popover/ChatCardMenu/Sidebar's row menu now run on Radix, ViewToggle and the palette are on Tailwind. Every remaining component gets the same mechanical treatment: **no behavior change, no new dependencies** — only its CSS moves from `App.css` classes to Tailwind utility classes (already picking up the refreshed palette automatically via Task 2's `@theme` tokens), and its old `App.css` rules are deleted in the same commit.

Apply this exact 5-step recipe to each component below, in order, stopping at the end of a component's commit if the session needs to end (never mid-component):

1. **Read the component's current JSX** (`src/components/<Name>.tsx`) and every `App.css` rule its `className`s reference (`grep -n "^\.<class-name>" src/App.css` for each class used).
2. **Rewrite the JSX's `className` props** to equivalent Tailwind utility classes using the `@theme` tokens from Task 2 (`bg-bg-primary`, `text-text-secondary`, `border-border`, `bg-accent`, etc.) — matching the deleted rule's exact declarations (padding, radius, colors, flex layout, hover states via Tailwind's `hover:` variant) so there is zero visual diff. Keep any inline `style={{...}}` that depends on runtime values (e.g. computed positions) — only static CSS moves to utility classes.
3. **Delete the migrated `App.css` rules** for that component only — grep again afterward for any remaining reference to the deleted class names elsewhere in `src/` before deleting, in case another component shares the class.
4. **Verify**: `npm run dev`, visually compare the component against its pre-migration appearance (open the relevant view — Sidebar, Chat, Canvas, or Preview, whichever the component lives in); run `npm test && npx tsc --noEmit`.
5. **Commit**: `git add src/components/<Name>.tsx src/App.css && git commit -m "style: restyle <Name> with Tailwind"`.

Apply the recipe to these components, in this order (most-visible-first, per the design spec):

- [ ] **Task 8:** `src/components/Sidebar.tsx` (remaining non-menu parts: `.sidebar`, `.sidebar-navrow*`, `.sidebar-nav`, `.sidebar-search`, `.sidebar-list`, `.sidebar-section-header`, `.sidebar-empty`, `.sidebar-row*`, `.sidebar-footer`, `.sidebar-avatar`, `.sidebar-email`) + `src/components/InputBar.tsx` + `src/components/InputToolbelt.tsx` (the non-Popover parts: `.pill*`, `.attachment-strip`, `.attachment-chip`)
- [ ] **Task 9:** `src/components/MessageBlock.tsx` + `src/components/MessageList.tsx` + `src/components/ChatPane.tsx` + `src/components/ChatView.tsx`
- [ ] **Task 10:** `src/components/PresenceBar.tsx` + `src/components/LiveCursors.tsx` + `src/components/GroupLabel.tsx`
- [ ] **Task 11:** `src/components/MainAgentInstrument.tsx` + `src/components/RenderPreviewButton.tsx` + `src/components/ThinkingIndicator.tsx` + `src/components/PulseEdge.tsx` + `src/components/ResizeDivider.tsx`
- [ ] **Task 12:** `src/components/CanvasView.tsx` — verify carefully against the React-Flow-stylesheet specificity bug already hit once (`decisions.md`, 2026-08-17 entry); test node drag/resize after restyling, not just static appearance.
- [ ] **Task 13:** `src/components/LoginScreen.tsx`
- [x] **Task 14:** `src/components/PreviewPage.tsx` + `src/components/PreviewToolbar.tsx` + `src/components/PreviewAnnotationLayer.tsx` + `src/components/PreviewCommentPanel.tsx`

If Tasks 12-14 aren't reached in this session, the next session picks up at the next unstarted task in this list — no re-planning needed, this document remains the plan.

---

## Self-Review Notes

- **Spec coverage:** Section 1 (Foundation) → Tasks 1-3. Section 2 (Tier 1) → Tasks 4-7, including the corrected finding that Sidebar/ChatCardMenu had *no* existing delete confirmation to "replace" — both get one added, consistent with the design spec's framing of Tier 1 as "real behavior win" swaps. Section 3 (Tier 2) → Tasks 8-14 via the recipe pattern, in the spec's exact ordering.
- **Why Tier 2 tasks use a recipe instead of full inline code:** the design spec explicitly commits to zero behavior/layout change for these ~20 components, and each one's exact current CSS declarations must be read at execution time to guarantee a pixel-faithful conversion — fabricating "equivalent" Tailwind classes now, without re-reading each file's current rules at execution time, risks silently drifting from what's actually in `App.css` today. The recipe is concrete and mechanical (unlike a vague "restyle appropriately"): 5 fixed steps, exact grep commands, exact commit format.
- **Type/name consistency check:** `Popover`/`PopoverHeader`/`PopoverRow`/`PopoverDivider` export names and props are unchanged across Task 4 and their two consumer files (verified neither `Sidebar.tsx` nor `InputToolbelt.tsx` needs edits). `ChatCardMenu`'s props (`title`, `onRename`, `onDelete?`) are unchanged across Task 5 and its two consumers (`ChatCard.tsx`, `ChatView.tsx`). `SidebarRow`'s props are unchanged across Task 6 and its one caller (`Sidebar`'s own `.map()`).
