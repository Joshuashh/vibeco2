import { useState } from "react";
import { signIn, signInWithGitHub } from "../lib/auth";

export function LoginScreen({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [githubBusy, setGithubBusy] = useState(false);
  const busy = submitting || githubBusy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await signIn(email, password);
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleGitHub() {
    setError(null);
    setGithubBusy(true);
    try {
      await signInWithGitHub();
      onSignedIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "GitHub sign-in failed");
    } finally {
      setGithubBusy(false);
    }
  }

  return (
    <div className="flex items-center justify-center h-screen bg-bg-primary">
      <div className="flex flex-col gap-3 w-[280px]">
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <h1>Sign in</h1>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
          />
          <button type="submit" disabled={busy}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <div className="flex items-center gap-2 text-text-tertiary text-[0.8em]">
          <span className="flex-1 h-px bg-border" />
          or
          <span className="flex-1 h-px bg-border" />
        </div>

        <button type="button" onClick={handleGitHub} disabled={busy}>
          {githubBusy ? "Opening GitHub…" : "Continue with GitHub"}
        </button>

        {error && <p className="text-danger text-[0.9em] m-0">{error}</p>}
      </div>
    </div>
  );
}
