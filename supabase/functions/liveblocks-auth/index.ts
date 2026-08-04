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
