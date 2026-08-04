# Vibeco2 — Auth Design

Date: 2026-08-04
Status: Brainstormed and agreed; not yet planned or implemented.

## 1. Purpose

Auth is next specifically because it unblocks RLS: `chats`/`messages` currently have Row Level
Security disabled, so anyone holding the app's Supabase anon (publishable) key can read/write
every row (see `decisions.md`, "Open security gap: RLS disabled"). This closes that gap for the
current single-developer stage of the app. Multi-user rooms/membership (spec.md §6) are explicitly
out of scope — deferred to the multiplayer/Canvas phase.

## 2. Scope decisions

- **Single user.** One person (the developer) signs in. No team/room/membership model yet.
- **Sign-in method: email + password**, via Supabase Auth. Rejected magic link (email-round-trip
  friction for frequent local testing) and OAuth (extra app registration/redirect setup for a
  single-user app).
- **Account creation: out-of-band.** The one account is created once via the Supabase dashboard
  (or CLI), not through an in-app sign-up form. The app ships a sign-in screen only — smaller
  attack surface, less UI.
- **Session persistence: stay signed in.** Uses Supabase Auth's default localStorage-backed
  session. The app opens straight to chat if already authenticated; the login screen only appears
  on first run or after an explicit sign-out.
- **Existing test data: wiped, not migrated.** The handful of `chats`/`messages` rows created
  during foundation-plan testing have no owner and are treated as throwaway dev data — deleted
  before the `user_id` column is added, rather than backfilled.

## 3. Data model & RLS

- `chats` gains `user_id uuid not null references auth.users(id) default auth.uid()`.
- `messages` is **not** given its own `user_id` column — ownership is derived through
  `messages.chat_id -> chats.user_id`, avoiding a duplicated, independently-driftable ownership
  field.
- RLS enabled on both tables:
  - `chats`: policies for select/insert/update/delete, each checking `auth.uid() = user_id`.
  - `messages`: policies for select/insert/update/delete, each checking that
    `auth.uid() = (select user_id from chats where chats.id = messages.chat_id)`.
- Migration order: (1) delete existing rows from `messages` then `chats` (FK order), (2) add the
  `user_id` column with `not null default auth.uid()`, (3) enable RLS on both tables, (4) add the
  four policies (two tables × read/write, or finer-grained select/insert/update/delete — finalize
  exact policy count during planning).

## 4. Application changes

- **`src/lib/auth.ts` (new)** — thin wrapper around `supabase.auth`:
  - `signIn(email, password)` → `supabase.auth.signInWithPassword`
  - `signOut()` → `supabase.auth.signOut`
  - `getSession()` → `supabase.auth.getSession`
  - subscribe helper around `supabase.auth.onAuthStateChange`
- **`src/components/LoginScreen.tsx` (new)** — email + password fields, submit button, inline
  error message on failed sign-in. No sign-up link.
- **`src/App.tsx`** — on mount, check `getSession()`; subscribe to auth state changes. Render
  `LoginScreen` when there is no session, the existing `ChatView`/`InputBar` shell when there is.
  Add a minimal sign-out control (e.g. a button near the input bar) that calls `signOut()`.
- **`src/lib/persistChat.ts`** — `createChat` is unchanged at the call site; the `user_id` column's
  `default auth.uid()` means the authenticated Supabase client fills it in automatically on
  insert. No explicit `user_id` plumbing needed in application code.
- **`src/lib/supabase.ts`** — unchanged; the existing client already reads `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_ANON_KEY` from env.

## 5. Testing

- New `vitest` cases for `src/lib/auth.ts` against a mocked Supabase client: successful sign-in
  resolves with a session, failed sign-in surfaces a readable error, `signOut` clears session.
- Existing `persistChat.test.ts` / `message.test.ts` are unaffected by this change.
- Manual verification (required, since this is a real auth/RLS change): sign in with the real
  account in the built `.app`, confirm a chat/message round-trips through Supabase, and confirm an
  unauthenticated `supabase-js` client (or the anon key alone via `curl`/SQL) is rejected by RLS
  on both tables.

## 6. Out of scope

- Password reset / forgot-password flow.
- Multi-user accounts, room/team membership, invites.
- OAuth providers.
- Any UI for account management beyond sign-in/sign-out.

These remain open per spec.md §6 and are deferred to whichever plan adds multiplayer rooms.
