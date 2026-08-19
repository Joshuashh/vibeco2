# Tailwind + Radix/shadcn Migration — Design

## Context

The app has zero UI kit: `src/App.css` is 1,663 lines of hand-rolled CSS across 24 components, including fully custom interactive primitives like `Popover.tsx` (164 lines reimplementing collision/flip-to-avoid-edges positioning). User flagged the app "looks awful" and asked what UI kit to adopt. Recommendation logged in `decisions.md` (2026-08-19): Tailwind CSS v4 + Radix/shadcn, rejecting MUI/Chakra/Ant Design because they impose their own visual identity, fighting the existing dark palette pulled from the sibling Claude Code GUI (Swift) project's `AC` color system (`App.css:22-40`).

## Decisions

- **Component library:** shadcn/ui (CLI copies styled Radix-based component source into `src/components/ui/`, owned and edited directly) over raw `@radix-ui/react-*` packages styled from scratch. Less boilerplate, matches Tailwind conventions.
- **Session scope:** Tier 1 (Radix swaps) fully, then start Tier 2 (restyle) in priority order, stopping at a clean component boundary if the session runs long — not mid-component.
- **Cleanup pace:** delete each migrated component's old `App.css` rules in the same commit that migrates it. `App.css` shrinks monotonically; no dead CSS accumulates.
- **Visual upgrade:** palette refresh, woven into the same per-component migration (not a separate pass). Explored 4 directions via the visual companion (baseline, warmer/sepia, cool-neutral, deep-contrast) against a mini chat+sidebar mockup — user picked **cool neutral, same accent** (surfaces shifted toward blue-gray, à la Linear/Vercel dark mode; the existing orange accent kept as-is, now the one warm note against a cooler background). See "New palette" below for the concrete token values. Layout/structure and the accent/status colors are unchanged — only the neutral surface/text scale shifts.

## Section 1: Foundation

- `npm install -D tailwindcss @tailwindcss/vite`; add the Vite plugin to `vite.config.ts` (Tailwind v4 needs no PostCSS config).
- New `src/index.css` (or repurpose the top of `App.css`) with `@import "tailwindcss";` plus an `@theme` block. Neutral surface/text/border/canvas tokens shift to the cool-neutral palette below; accent and semantic status colors (accent, merged, held, conflict, danger) are unchanged — they're semantic signal colors, not part of the neutral-scale refresh.

  | Token | Old (App.css:22-40) | New |
  |---|---|---|
  | `--bg-primary` | `#1c1c1c` | `#18191c` |
  | `--bg-sidebar` | `#161616` | `#131417` |
  | `--bg-secondary` | `#282828` | `#232529` |
  | `--bg-tertiary` | `#323232` | `#2b2d33` |
  | `--text-primary` | `#ececec` | `#eef0f4` |
  | `--text-secondary` | `#999999` | `#8d92a0` |
  | `--text-tertiary` | `#707070` | `#63676f` |
  | `--border` | `#404040` | `#35373d` |
  | `--user-bubble` | `#383838` | `#2a2c31` |
  | `--send-active` | `#bfbfbf` | `#c4c8d1` |
  | `--canvas-bg` | `#0c0c0d` | `#0d0e10` |
  | `--canvas-dot` | `#232326` | `#24262b` |
  | `--accent` / `--accent-dim` | `#ed6b26` / 16% | unchanged |
  | `--merged` / `--held` / `--conflict` / `--danger` | as-is | unchanged |

  Each Tailwind token maps to the *new* value (e.g. `--color-bg-primary: #18191c;`), so components get the refreshed palette automatically as they migrate off raw `App.css` var references. Existing `var(--bg-primary)` usages in not-yet-migrated `App.css` rules are updated to the new hex values in the same edit (global find-and-replace across the 12 changed tokens, since they're plain `:root` values, not computed) — so the whole app reflects the new neutrals immediately after Section 1, before any component migrates mechanically.
- `npx shadcn@latest init`, mapped onto the refreshed palette tokens — no default shadcn theme.
- Verify: `tauri dev` shows the new cool-neutral palette app-wide, accent/status colors unchanged, no layout shift.

## Section 2: Tier 1 — Radix/shadcn swaps

- **`Popover.tsx`**: delete the hand-rolled collision/flip logic, replace with shadcn's `Popover` (`@radix-ui/react-popover`, Floating-UI-backed edge avoidance built in).
- **`ChatCardMenu.tsx`**: rebuild on shadcn's `DropdownMenu` (it's a menu of actions, not a generic popover) rather than composing the new `Popover`.
- **Sidebar delete-confirmation**: shadcn `AlertDialog`, replacing the inline confirm state in `Sidebar.tsx`.
- **`ViewToggle.tsx`**: **not** Radix `Tabs` — its content panels render elsewhere in `App.tsx`/view components, not as `Tabs.Content` children, so wrapping it in `Tabs.Root` would add indirection with no behavioral gain. Restyle as plain Tailwind utility classes (segmented-button look), keep it the same dumb controlled component it is today. Filed under Tier 1 because it was misclassified in the original recommendation, not because it needs Radix.

One commit per component; old `App.css` rules for that component removed in the same commit.

## Section 3: Tier 2 — remaining restyles

Order (most-visible-first, so partial progress stays coherent if the session ends mid-list):

1. `Sidebar.tsx` (non-dialog parts) + `InputBar.tsx` / `InputToolbelt.tsx`
2. `MessageBlock.tsx` / `MessageList.tsx` / `ChatPane.tsx` / `ChatView.tsx`
3. `PresenceBar.tsx` / `LiveCursors.tsx` / `GroupLabel.tsx`
4. `MainAgentInstrument.tsx` / `RenderPreviewButton.tsx` / `ThinkingIndicator.tsx` / `PulseEdge.tsx` / `ResizeDivider.tsx`
5. `CanvasView.tsx` — React Flow styling; likely trickiest given the specificity bug already hit once (`decisions.md`, 2026-08-17 entry: React Flow's own stylesheet won over a resize-handle override).
6. `LoginScreen.tsx`
7. Preview page trio: `PreviewPage.tsx` / `PreviewToolbar.tsx` / `PreviewAnnotationLayer.tsx` / `PreviewCommentPanel.tsx` — newest code, lowest priority to re-touch.

One component = one commit, `App.css` shrinks each time.

## Out of scope

- No new dependencies beyond Tailwind v4 + shadcn's Radix packages.
- No layout/structure redesign — only the neutral color scale refreshes (per "Visual upgrade" above) and the implementation mechanism (CSS/positioning logic) changes. Accent and status colors, spacing, and component arrangement stay as-is.
- Tier 2 components not reached this session carry over to a future session, picked up at the next unstarted item in the Section 3 order.
