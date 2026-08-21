import { createClient } from "npm:@supabase/supabase-js@2";
import { Liveblocks } from "npm:@liveblocks/node@3";
import { extractBearerToken } from "./verify.ts";

// Rooms are named "vibeco2-project-<uuid>" (see src/lib/liveblocks.ts) or,
// for pre-multi-project clients still in the wild, the legacy global room.
// No per-project membership check yet — mirrors the open shared-workspace
// model already used for the `projects`/`chats` tables (any authenticated
// user can join any room), so this just validates the room name shape.
const ROOM_ID_PATTERN = /^vibeco2-(project-[0-9a-f-]{36}|global)$/;

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

  const { room } = await req.json().catch(() => ({ room: undefined }));
  if (typeof room !== "string" || !ROOM_ID_PATTERN.test(room)) {
    return new Response(JSON.stringify({ error: "invalid room" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const session = liveblocks.prepareSession(data.user.id, {
    userInfo: { email: data.user.email ?? "" },
  });
  session.allow(room, session.FULL_ACCESS);

  const { status, body } = await session.authorize();
  return new Response(body, { status, headers: corsHeaders });
});
