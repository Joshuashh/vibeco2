import type { Session } from "@supabase/supabase-js";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { supabase } from "./supabase";

// Fixed so it can be pre-registered on the GitHub OAuth app and Supabase's
// redirect allow-list. Must be free when sign-in starts (the Rust
// `oauth_listen` command errors clearly if it isn't).
const OAUTH_REDIRECT_PORT = 8899;

// The GitHub access token Supabase returns as `provider_token`. It's handed
// back only on the initial code exchange and never refreshed, so we stash it
// here for a later GitHub-API feature to pick up via `getGitHubToken()`.
const GITHUB_TOKEN_KEY = "vibeco.github_provider_token";

export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("sign-in succeeded but no session was returned");
  return data.session;
}

export async function signInWithGitHub(): Promise<Session> {
  // 127.0.0.1, not "localhost" — on macOS "localhost" can resolve to IPv6
  // ::1 first, but the Rust `oauth_listen` binds IPv4, so the redirect would
  // hit a closed port ("connection refused").
  const redirectTo = `http://127.0.0.1:${OAUTH_REDIRECT_PORT}`;
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      // `repo` so the captured token can act on the user's repositories in a
      // later feature; `user:email` so an email is always available to link
      // against an existing password account.
      scopes: "read:user user:email repo",
    },
  });
  if (error) throw new Error(error.message);
  if (!data.url) throw new Error("GitHub sign-in didn't return an authorization URL");

  // Start the listener before opening the browser so the redirect can't
  // arrive before we're ready for it.
  const codePromise = invoke<string>("oauth_listen", { port: OAUTH_REDIRECT_PORT });
  await openUrl(data.url);
  const code = await codePromise;

  const { data: exchanged, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) throw new Error(exchangeError.message);
  if (!exchanged.session) throw new Error("GitHub sign-in succeeded but no session was returned");

  if (exchanged.session.provider_token) {
    localStorage.setItem(GITHUB_TOKEN_KEY, exchanged.session.provider_token);
  }

  // Persist the GitHub username so teammates can invite each other to a
  // project's repo by login (see lib/github.ts `addCollaborator`). Fire and
  // forget — a profiles-write hiccup shouldn't fail an otherwise-good login.
  const login = exchanged.session.user.user_metadata?.user_name as string | undefined;
  if (login) {
    void supabase
      .from("profiles")
      .update({ github_login: login })
      .eq("id", exchanged.session.user.id)
      .then(({ error }) => {
        if (error) console.error("couldn't save github_login", error);
      });
  }
  return exchanged.session;
}

/** The stored GitHub access token from the last GitHub sign-in, or null. */
export function getGitHubToken(): string | null {
  return localStorage.getItem(GITHUB_TOKEN_KEY);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
  localStorage.removeItem(GITHUB_TOKEN_KEY);
}

export async function getSession(): Promise<Session | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session;
}

export function onAuthStateChange(callback: (session: Session | null) => void): () => void {
  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => callback(session));
  return () => subscription.unsubscribe();
}
