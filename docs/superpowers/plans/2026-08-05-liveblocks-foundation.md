# Liveblocks Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Liveblocks room + auth pipeline with presence as the first working proof that two people are in the same shared space, per `docs/superpowers/specs/2026-08-05-liveblocks-foundation-design.md`.

**Architecture:** A Supabase Edge Function (`liveblocks-auth`) verifies the caller's existing Supabase session and mints a Liveblocks token scoped to one fixed global room (`"vibeco2-global"`). The client (`@liveblocks/client` + `@liveblocks/react`) calls that function whenever Liveblocks needs a token, then renders a simple online-now list via `useOthers`/`useSelf`. No new Supabase tables; `chats`/`messages` and their RLS are untouched.

**Tech Stack:** `@liveblocks/client`, `@liveblocks/react` (npm, client-side), `@liveblocks/node` + `@supabase/supabase-js` (Deno `npm:` imports, edge function only), existing Supabase project `febfuemspzwslaujdtwc`.

---

### Task 1: Provision external accounts (manual — no files)

Two things need to exist before any code will work, and both require you personally (account creation/credentials can't be done on your behalf):

- [ ] **Step 1: Create a Liveblocks account and project**

Go to https://liveblocks.io, sign up (or sign in), and create a new project. From the project's
API keys page, copy the **secret key** (starts with `sk_`). Keep it handy — Task 5 needs it.

- [ ] **Step 2: Create a second Supabase Auth test account**

Same manual process used for the first account (per `HANDOFF.md`): open the Supabase dashboard
for project `febfuemspzwslaujdtwc` → Authentication → Users → Add user, with a throwaway
email/password, auto-confirmed. This is the second identity used for the two-tab verification in
Task 10.

Nothing to commit — this step only produces two credentials you'll use later in this plan.

---

### Task 2: Install Liveblocks client packages

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the packages**

Run: `npm install @liveblocks/client @liveblocks/react`

- [ ] **Step 2: Verify they're in package.json**

Run: `cat package.json | grep liveblocks`
Expected: both `@liveblocks/client` and `@liveblocks/react` listed under `dependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add liveblocks client dependencies"
```

---

### Task 3: Write and test the bearer-token helper (TDD)

The edge function needs to pull the Supabase access token out of the `Authorization` header
before it can verify it. This tiny piece of logic has no runtime-specific dependencies, so it's
the one part of the edge function that gets a real unit test (per the design spec §5).

**Files:**
- Create: `supabase/functions/liveblocks-auth/verify.ts`
- Test: `supabase/functions/liveblocks-auth/verify.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from "vitest";
import { extractBearerToken } from "./verify.ts";

describe("extractBearerToken", () => {
  it("returns the token from a well-formed header", () => {
    expect(extractBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("throws when the header is missing", () => {
    expect(() => extractBearerToken(null)).toThrow(
      "missing or malformed Authorization header"
    );
  });

  it("throws when the header doesn't start with Bearer", () => {
    expect(() => extractBearerToken("Basic abc123")).toThrow(
      "missing or malformed Authorization header"
    );
  });

  it("throws when the token is empty after Bearer", () => {
    expect(() => extractBearerToken("Bearer ")).toThrow(
      "missing or malformed Authorization header"
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run supabase/functions/liveblocks-auth/verify.test.ts`
Expected: FAIL — `verify.ts` does not exist / `extractBearerToken` is not exported.

- [ ] **Step 3: Write the implementation**

```typescript
export function extractBearerToken(authHeader: string | null): string {
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("missing or malformed Authorization header");
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    throw new Error("missing or malformed Authorization header");
  }
  return token;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run supabase/functions/liveblocks-auth/verify.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/liveblocks-auth/verify.ts supabase/functions/liveblocks-auth/verify.test.ts
git commit -m "feat: add bearer-token extraction helper for liveblocks auth"
```

---

### Task 4: Write the Liveblocks auth edge function

This is the Deno entrypoint that Supabase actually runs. It's glue code (verifies the Supabase
session, mints a Liveblocks token) with no practical way to unit test the network calls, so it's
verified end-to-end in Task 10 instead — consistent with the design spec's testing scope.

**Files:**
- Create: `supabase/functions/liveblocks-auth/index.ts`

- [ ] **Step 1: Write the function**

```typescript
import { createClient } from "npm:@supabase/supabase-js@2";
import { Liveblocks } from "npm:@liveblocks/node@3";
import { extractBearerToken } from "./verify.ts";

const ROOM_ID = "vibeco2-global";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const liveblocks = new Liveblocks({
  secret: Deno.env.get("LIVEBLOCKS_SECRET_KEY")!,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let token: string;
  try {
    token = extractBearerToken(req.headers.get("Authorization"));
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!
  );
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return new Response(JSON.stringify({ error: "invalid session" }), {
      status: 401,
      headers: corsHeaders,
    });
  }

  const session = liveblocks.prepareSession(data.user.id, {
    userInfo: { email: data.user.email ?? "" },
  });
  session.allow(ROOM_ID, session.FULL_ACCESS);

  const { status, body } = await session.authorize();
  return new Response(body, { status, headers: corsHeaders });
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/liveblocks-auth/index.ts
git commit -m "feat: add liveblocks-auth edge function"
```

---

### Task 5: Deploy the edge function and set its secret

**Files:** none — deployment/configuration only.

- [ ] **Step 1: Deploy the function**

Use the Supabase MCP tool `deploy_edge_function` (load it via `ToolSearch` with
`select:mcp__6928130d-9709-4aae-99b9-7b1126eaab03__deploy_edge_function` if not already loaded)
with:
- `project_id`: `febfuemspzwslaujdtwc`
- function name/slug: `liveblocks-auth`
- entrypoint contents: the contents of `supabase/functions/liveblocks-auth/index.ts` and
  `supabase/functions/liveblocks-auth/verify.ts` (both files — `index.ts` imports the second one)

- [ ] **Step 2: Set the Liveblocks secret key**

There is no MCP tool for setting Edge Function secrets, so this needs the Supabase CLI, which
needs an interactive login — run these yourself in a terminal (not something to script blindly,
since `supabase login` opens a browser):

```bash
npx supabase login
npx supabase link --project-ref febfuemspzwslaujdtwc
npx supabase secrets set LIVEBLOCKS_SECRET_KEY=<the sk_... key from Task 1> --project-ref febfuemspzwslaujdtwc
```

- [ ] **Step 3: Confirm the function is live**

Use the Supabase MCP tool `get_logs` (service: `edge-function`) or `list_edge_functions` for
project `febfuemspzwslaujdtwc` and confirm `liveblocks-auth` shows up as deployed.

Nothing to commit — this is remote configuration, not a file change.

---

### Task 6: Add the edge function URL as a client env var

**Files:**
- Modify: `.env.example`
- Modify: `.env.local` (not committed — gitignored via `*.local`)

- [ ] **Step 1: Add to `.env.example`**

Append to `.env.example`:

```
VITE_LIVEBLOCKS_AUTH_URL=https://your-project.supabase.co/functions/v1/liveblocks-auth
```

- [ ] **Step 2: Add the real value to `.env.local`**

Append to `.env.local`:

```
VITE_LIVEBLOCKS_AUTH_URL=https://febfuemspzwslaujdtwc.supabase.co/functions/v1/liveblocks-auth
```

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: add liveblocks auth env var to .env.example"
```

(`.env.local` is gitignored — nothing to stage there.)

---

### Task 7: Add the Liveblocks client and room context

**Files:**
- Create: `src/lib/liveblocks.ts`

- [ ] **Step 1: Write the client**

```typescript
import { createClient } from "@liveblocks/client";
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
};

export const { RoomProvider, useOthers, useSelf } = createRoomContext<Presence>(client);
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/liveblocks.ts
git commit -m "feat: add liveblocks client and room context"
```

---

### Task 8: Add the PresenceBar component

**Files:**
- Create: `src/components/PresenceBar.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { useOthers, useSelf } from "../lib/liveblocks";

export function PresenceBar() {
  const self = useSelf();
  const others = useOthers();

  const names = [
    `You (${self?.presence.email ?? "unknown"})`,
    ...others.map((other) => other.presence.email),
  ];

  return <div className="presence-bar">{names.join(", ")} online</div>;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PresenceBar.tsx
git commit -m "feat: add PresenceBar component"
```

---

### Task 9: Wire RoomProvider and PresenceBar into App.tsx

**Files:**
- Modify: `src/App.tsx:1-10` (imports), `src/App.tsx:63-71` (return block)
- Modify: `src/App.css`

- [ ] **Step 1: Update imports**

In `src/App.tsx`, add to the existing import block:

```typescript
import { RoomProvider, ROOM_ID } from "./lib/liveblocks";
import { PresenceBar } from "./components/PresenceBar";
```

- [ ] **Step 2: Wrap the authenticated view in RoomProvider**

Replace the existing return block in `src/App.tsx`:

```typescript
  return (
    <div className="app">
      <button className="sign-out" onClick={() => signOut()}>
        Sign out
      </button>
      <ChatView messages={messages} />
      <InputBar onSend={handleSend} disabled={streaming} />
    </div>
  );
```

with:

```typescript
  return (
    <RoomProvider id={ROOM_ID} initialPresence={{ email: session.user.email ?? "unknown" }}>
      <div className="app">
        <PresenceBar />
        <button className="sign-out" onClick={() => signOut()}>
          Sign out
        </button>
        <ChatView messages={messages} />
        <InputBar onSend={handleSend} disabled={streaming} />
      </div>
    </RoomProvider>
  );
```

- [ ] **Step 3: Add presence bar styling**

Append to `src/App.css`:

```css
.presence-bar {
  position: absolute;
  top: 1em;
  left: 1em;
  font-size: 0.85em;
  color: #666;
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Run the full test suite**

Run: `npm test`
Expected: all existing tests pass, plus the 4 new `extractBearerToken` tests.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "feat: wire liveblocks presence into the authenticated app view"
```

---

### Task 10: Manual end-to-end verification

**Files:**
- Modify: `HANDOFF.md`

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Open two browser tabs**

Open `http://localhost:1420` in two separate browser tabs (a plain web view of the Vite dev
server is enough — no need to build/launch the native `.app` twice for this check).

- [ ] **Step 3: Sign in with two different accounts**

In tab 1, sign in with your original account. In tab 2, sign in with the second test account
created in Task 1.

- [ ] **Step 4: Confirm presence shows both**

Confirm tab 1's presence bar reads `You (<your email>), <test account email> online`, and tab 2's
reads the mirror image. Close tab 2 (or sign out) and confirm tab 1's presence bar drops back to
just `You (<your email>) online` within a few seconds.

- [ ] **Step 5: Update HANDOFF.md**

Replace the "Next steps" section with a short note that the Liveblocks foundation (room + auth
edge function + presence) landed and works across two independent sessions, and that Canvas card
sync / human chat / streamed AI content are still unplanned per `spec.md` §6.

- [ ] **Step 6: Commit**

```bash
git add HANDOFF.md
git commit -m "docs: hand-off for liveblocks foundation completion"
```
