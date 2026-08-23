import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { showToast } from "./ToastHost";

const POLL_MS = 5 * 60 * 1000;

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

// Polls whether the app's own repo (not any user project — see
// git_ops::app_repo_root) is behind origin/main, and pulls it on click.
// `tauri dev`'s own file watcher does the actual "recompile" once the
// pulled files land on disk — this only has to get them there.
export function UpdateButton() {
  const [available, setAvailable] = useState(false);
  const [pulling, setPulling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function check() {
      invoke<boolean>("check_for_app_update")
        .then((behind) => {
          if (!cancelled) setAvailable(behind);
        })
        .catch((err) => console.error("failed to check for app update", err));
    }
    check();
    const interval = window.setInterval(check, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function pull() {
    if (!available) return;
    setPulling(true);
    try {
      await invoke("pull_app_update");
      setAvailable(false);
      showToast("Pulled the latest main — tauri dev will rebuild automatically.", "info");
    } catch (err) {
      console.error("failed to pull app update", err);
      showToast("Couldn't pull the latest main — check for local changes or conflicts.");
    } finally {
      setPulling(false);
    }
  }

  return (
    <button
      type="button"
      className="icon-button icon-button-sm"
      style={available ? { color: "var(--held)" } : { color: "var(--text-tertiary)", cursor: "default" }}
      title={
        pulling
          ? "Pulling latest main…"
          : available
            ? "Update available on main — click to pull"
            : "Up to date with main"
      }
      onClick={pull}
      disabled={pulling || !available}
    >
      <DownloadIcon />
    </button>
  );
}
