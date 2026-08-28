import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set (see .env.example)");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // GitHub sign-in (auth.ts `signInWithGitHub`) catches the OAuth redirect
    // on a loopback port and calls `exchangeCodeForSession` — that's the PKCE
    // flow. `detectSessionInUrl` is off because this is a native window, not
    // a page that ever loads with auth params in its own URL.
    flowType: "pkce",
    detectSessionInUrl: false,
  },
});
