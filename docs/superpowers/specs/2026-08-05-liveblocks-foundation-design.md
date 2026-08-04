# Liveblocks Foundation — Design Spec

Date: 2026-08-05
Status: Brainstormed and agreed; not yet planned or implemented.

## 1. What this is

The first slice of the multiplayer layer described in `spec.md` §3 and `decisions.md`'s
realtime-split decision. It does **not** attempt the full multiplayer vision in one pass —
that vision (live cursors over a Canvas, canvas card drag-sync, human-to-human chat, streamed
AI conversation content between teammates) bundles several independent subsystems, and this
app currently has no multi-user concept at all: auth is single-user, RLS on `chats`/`messages`
is owner-only, and there is no Canvas view yet.

This spec scopes down to: **stand up the Liveblocks room + auth pipeline, with presence as the
first working, verifiable proof that two people are in the same shared space.** Canvas card
sync, human chat delivery, and streamed AI content are separate, later specs once this
foundation exists.

## 2. Room model

**One fixed global room**, id `"vibeco2-global"`. Everyone who signs in lands in the same
shared space — no workspace/team concept, no membership table. This matches the "coworking
space" framing in `spec.md` §1 and avoids building for a multi-team need that doesn't exist yet
(it's one team). If multiple separate teams are ever needed, that's a workspace-model spec of
its own, deferred until there's an actual second team.

This slice does not touch `chats`/`messages` or their RLS policies. Seeing a teammate's actual
chat content is out of scope here — this is presence only.

## 3. Auth pipeline

Liveblocks needs to identify each connecting user server-side rather than trusting the client,
so a person's presence shows their real identity, not an anonymous guest.

```
Supabase Auth session (already exists, from the prior auth work)
        │  (access token, sent in Authorization header)
        ▼
Supabase Edge Function: liveblocks-auth
  - verifies the caller's Supabase JWT (rejects if invalid/expired)
  - calls Liveblocks' server SDK (@liveblocks/node) to mint a session
    token for room "vibeco2-global", identifying the user by their
    Supabase user id + email
  - LIVEBLOCKS_SECRET_KEY is set as an Edge Function secret — never
    shipped to the client, never appears in any bundled JS
        │  (liveblocks session token, JSON response)
        ▼
Client: @liveblocks/client + @liveblocks/react
  - createClient({ authEndpoint: <edge function URL>, ... })
    the client calls authEndpoint itself (with the Supabase access
    token attached) whenever it needs a token — no public API key
    needed client-side at all
  - <RoomProvider id="vibeco2-global"> wraps the app once signed in
  - useOthers() / useSelf() surface who else is currently connected
```

No public Liveblocks API key ships in the client build. The only Liveblocks credential that
exists client-side is the short-lived session token the edge function returns, scoped to one
room.

## 4. Client wiring

- New dependencies: `@liveblocks/client`, `@liveblocks/react`.
- `RoomProvider` mounts only once a Supabase session exists (i.e., inside the already-existing
  auth gate in `App.tsx`, alongside `ChatView`/`InputBar`) — an unauthenticated user never talks
  to Liveblocks at all.
- New component, `PresenceBar`: a thin strip near the existing sign-out button listing everyone
  currently connected, by email — e.g. "You, jane@example.com, 2 others online." No cursor
  tracking, no avatars, no positions — just `useOthers()` rendered as a list.
- New env var: the edge function's invoke URL (e.g. `VITE_LIVEBLOCKS_AUTH_URL`, alongside the
  existing `VITE_SUPABASE_*` vars in `.env`/`.env.example`).

## 5. Verification

Manual, two-identity test:

1. Create a second Supabase Auth test account the same manual way the first account was created
   (via the dashboard, per the existing auth work).
2. Run the Vite dev server and open two browser tabs (not two native `.app` launches — simplest
   way to get two independent, simultaneously-signed-in sessions without building/launching the
   bundle twice).
3. Sign into each tab with a different account.
4. Confirm each tab's `PresenceBar` shows the other account's email, and that closing/signing
   out of one tab removes it from the other's presence list within Liveblocks' normal
   disconnect window.

No automated test is proposed for the realtime round-trip itself (Liveblocks presence over a
live socket connection isn't practically unit-testable) — the edge function's JWT verification
logic is unit-testable and should get a test the way `auth.ts`/`persistChat.ts` already do.

## 6. Out of scope (deferred to later specs)

- Live cursors rendered over an actual shared surface — waits for the Canvas view to exist.
- Canvas card drag/position sync via Liveblocks Storage (`LiveList`/`LiveObject`/`LiveMap`).
- Human-to-human chat delivery.
- Streaming a person's live AI conversation content to onlookers.
- Any workspace/team/multi-room model.
- Any change to `chats`/`messages` RLS policies.
