import { useEffect, useRef, useState } from "react";
import { RefreshCw, MoreHorizontal, GitMerge, Check } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import type { Profile } from "../lib/profiles";
import type { ProjectRow } from "../types/project";
import { fetchQueueItems, deleteQueueItem, type QueueItem } from "../lib/queueItems";
import {
  fetchPromotionApprovals,
  insertPromotionApproval,
  clearPromotionApprovals,
  type PromotionApproval,
} from "../lib/promotion";
import {
  fetchPreviewPins,
  fetchPreviewPinReplies,
  fetchPreviewStrokes,
  insertPreviewPin,
  insertPreviewPinReply,
  setPinResolved,
  deletePreviewPin,
  movePreviewPin,
  insertPreviewStroke,
  deletePreviewStroke,
  clearOwnPreviewStrokes,
  lastOwnStroke,
  visiblePins,
  pinsOnPage,
  repliesByPin,
  type PreviewPin,
  type PreviewPinReply,
  type PreviewStroke,
} from "../lib/previewComments";
import type { PercentPoint } from "../lib/overlayGeometry";
import { PreviewToolbar, type PreviewTool } from "./PreviewToolbar";
import { PillToggle } from "./PillToggle";
import { PreviewAnnotationLayer } from "./PreviewAnnotationLayer";
import { PreviewCommentPanel } from "./PreviewCommentPanel";
import { showToast } from "./ToastHost";

// Same fixed port preview_server.rs always uses — see MainAgentInstrument.tsx.
const TEAM_PREVIEW_URL = "http://localhost:5180";

export function PreviewPage({
  session,
  project,
  activeChatId,
  profiles,
}: {
  session: Session;
  project: ProjectRow;
  activeChatId: string | null;
  profiles: Profile[];
}) {
  const [target, setTarget] = useState<"team" | "local">("team");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [previewStatus, setPreviewStatus] = useState<"starting" | "ready" | "error">("starting");
  const [localPort, setLocalPort] = useState<number | null>(null);
  const [tool, setTool] = useState<PreviewTool>("cursor");
  const [pins, setPins] = useState<PreviewPin[]>([]);
  const [replies, setReplies] = useState<PreviewPinReply[]>([]);
  const [strokes, setStrokes] = useState<PreviewStroke[]>([]);
  const [showResolved, setShowResolved] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openPinId, setOpenPinId] = useState<string | null>(null);
  const [draftPin, setDraftPin] = useState<PercentPoint | null>(null);
  const [activeStroke, setActiveStroke] = useState<PercentPoint[] | null>(null);
  const [currentPagePath, setCurrentPagePath] = useState<string | null>(null);
  // Bumped to force the iframe to remount — a plain reload() call would need
  // cross-origin access to the iframe's window, which the browser blocks.
  const [reloadKey, setReloadKey] = useState(0);
  // Team preview is a local dev server per machine, not something a
  // teammate's merge pushes to automatically — this tracks whether
  // origin/team has commits this machine hasn't pulled into its own team
  // worktree yet, so the Update button can show that there's something to
  // get rather than silently doing nothing when clicked out of habit.
  const [teamHasUpdate, setTeamHasUpdate] = useState(false);
  const [pulling, setPulling] = useState(false);
  // The Preview window's overflow (⋯) menu, and the in-flight state of its
  // "Hard restart preview" action — a full kill+respawn of the dev server
  // (not just an iframe reload) for when the preview is showing stale content.
  const [menuOpen, setMenuOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  // team -> main promotion gate (Team mode only). `mergedItems` are queue
  // items already merged into `team` and now waiting for main; `approvals`
  // are bound to a specific team sha (see promotion.ts / 0026 migration).
  const [mergedItems, setMergedItems] = useState<QueueItem[]>([]);
  const [approvals, setApprovals] = useState<PromotionApproval[]>([]);
  const [shas, setShas] = useState<{ teamSha: string; mainSha: string } | null>(null);
  const [promoting, setPromoting] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // Set true by a hard reset so the next iframe load posts the storage-wipe
  // message to the (cross-origin) preview via its injected tracker script.
  // One-shot: cleared as soon as it fires, so the tracker's own reload after
  // clearing doesn't loop.
  const pendingResetRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setPreviewStatus("starting");
    setLocalPort(null);
    setCurrentPagePath(null);

    if (target === "team") {
      invoke("ensure_team_preview_running")
        .then(() => {
          if (!cancelled) setPreviewStatus("ready");
        })
        .catch((err) => {
          console.error("ensure_team_preview_running failed", err);
          if (!cancelled) setPreviewStatus("error");
        });
      return () => {
        cancelled = true;
      };
    }

    if (!activeChatId) {
      setPreviewStatus("error");
      return () => {
        cancelled = true;
      };
    }

    invoke<number>("ensure_chat_preview_running", { chatId: activeChatId })
      .then((port) => {
        if (!cancelled) {
          setLocalPort(port);
          setPreviewStatus("ready");
        }
      })
      .catch((err) => {
        console.error("ensure_chat_preview_running failed", err);
        if (!cancelled) setPreviewStatus("error");
      });
    return () => {
      cancelled = true;
      invoke("stop_chat_preview", { chatId: activeChatId }).catch((err) =>
        console.error("stop_chat_preview failed", err),
      );
    };
    // Local preview always tracks whichever chat is currently active app-wide
    // (there's only ever one — Cowork/Solo are two views of the same
    // activeChatId, not independent selections) rather than offering a
    // separate picker, so switching chats elsewhere in the app no longer
    // leaves Local preview pointed at a stale one.
  }, [target, activeChatId]);

  // Polls rather than pushing this over realtime — it's cheap (a bare `git
  // fetch`, no data transfer beyond refs) and every teammate needs to know
  // independently anyway, since "there's an update" is relative to each
  // person's own local team worktree, not a single shared value.
  useEffect(() => {
    if (target !== "team") {
      setTeamHasUpdate(false);
      return;
    }
    let cancelled = false;
    function check() {
      invoke<boolean>("team_preview_has_update")
        .then((has) => {
          if (!cancelled) setTeamHasUpdate(has);
        })
        .catch((err) => console.error("team_preview_has_update failed", err));
      // Same cheap fetch-only poll drives the promote gate's "is team ahead
      // of main" check and the sha its approvals are bound to.
      invoke<{ teamSha: string; mainSha: string }>("team_and_main_shas")
        .then((s) => {
          if (!cancelled) setShas(s);
        })
        .catch((err) => console.error("team_and_main_shas failed", err));
    }
    check();
    const id = setInterval(check, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [target]);

  function handleUpdateClick() {
    if (target !== "team") {
      setReloadKey((k) => k + 1);
      return;
    }
    // Re-ensuring the server here (not just on tab mount) means a dev-only
    // restart of the Rust binary — which kills its tracked `npm run dev`
    // child along with it — doesn't leave Team preview dead until someone
    // happens to leave and re-enter the tab. ensure_team_preview_running is
    // a no-op if a live child is already tracked, so this costs nothing on
    // the common path.
    setPulling(true);
    invoke("ensure_team_preview_running")
      .then(() => (teamHasUpdate ? invoke("pull_team_preview_update") : Promise.resolve()))
      .then(() => {
        setTeamHasUpdate(false);
        setPreviewStatus("ready");
        setReloadKey((k) => k + 1);
      })
      .catch((err) => {
        console.error("team preview update failed", err);
        showToast("Couldn't update the team preview — try again.");
      })
      .finally(() => setPulling(false));
  }

  // Hard restart: fully kill and respawn the dev server, then remount the
  // iframe — for when the normal Update (reload) still shows stale content
  // because the Vite process itself is wedged or missed new files. Team
  // preview goes through the dedicated restart_team_preview command; a local
  // (per-chat) preview is torn down and re-created for its chat.
  function handleHardRestart() {
    setMenuOpen(false);
    setRestarting(true);
    setPreviewStatus("starting");
    // Arm the storage wipe: the injected tracker clears localStorage/session
    // and reloads once the freshly-restarted iframe loads and we post to it —
    // so the previewed app behaves like a brand-new first visit (onboarding
    // and other first-run state reappear), not just a code/server refresh.
    pendingResetRef.current = true;
    const work =
      target === "team"
        ? invoke("restart_team_preview")
        : activeChatId
          ? invoke("stop_chat_preview", { chatId: activeChatId }).then(() =>
              invoke("ensure_chat_preview_running", { chatId: activeChatId })
            )
          : Promise.reject(new Error("no active chat to restart"));
    work
      .then(() => {
        setTeamHasUpdate(false);
        setPreviewStatus("ready");
        setReloadKey((k) => k + 1);
        showToast("Preview restarted.");
      })
      .catch((err) => {
        console.error("hard restart failed", err);
        pendingResetRef.current = false;
        setPreviewStatus("error");
        showToast("Couldn't restart the preview — try again.");
      })
      .finally(() => setRestarting(false));
  }

  // When a hard reset is pending, the first load of the restarted iframe gets
  // the storage-wipe message; the injected tracker clears storage and reloads
  // itself, so by the second load the previewed app sees a clean first-visit
  // state. One-shot via the ref so that self-triggered reload doesn't recurse.
  function handleIframeLoad() {
    if (!pendingResetRef.current) return;
    pendingResetRef.current = false;
    iframeRef.current?.contentWindow?.postMessage({ type: "vibeco-reset-storage" }, "*");
  }

  useEffect(() => {
    fetchPreviewPins().then(setPins).catch((err) => console.error("failed to fetch preview pins", err));
    fetchPreviewPinReplies()
      .then(setReplies)
      .catch((err) => console.error("failed to fetch preview pin replies", err));
    fetchPreviewStrokes().then(setStrokes).catch((err) => console.error("failed to fetch preview strokes", err));
  }, []);

  // Promote-gate data + its own realtime channel (kept separate from the
  // preview-comments one above so it can be project-scoped).
  useEffect(() => {
    fetchQueueItems(project.id)
      .then((items) => setMergedItems(items.filter((i) => i.status === "merged")))
      .catch((err) => console.error("failed to fetch merged queue items", err));
    fetchPromotionApprovals(project.id)
      .then(setApprovals)
      .catch((err) => console.error("failed to fetch promotion approvals", err));

    const channel = supabase
      .channel("promotion-gate-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "queue_items", filter: `project_id=eq.${project.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const row = payload.old as { id: string };
            setMergedItems((prev) => prev.filter((i) => i.id !== row.id));
            return;
          }
          const row = payload.new as QueueItem;
          setMergedItems((prev) => {
            const rest = prev.filter((i) => i.id !== row.id);
            return row.status === "merged" ? [...rest, row] : rest;
          });
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "promotion_approvals", filter: `project_id=eq.${project.id}` },
        (payload) => {
          const row = payload.new as PromotionApproval;
          setApprovals((prev) => (prev.some((a) => a.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "promotion_approvals" }, (payload) => {
        const row = payload.old as { id: string };
        setApprovals((prev) => prev.filter((a) => a.id !== row.id));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [project.id]);

  // The preview iframe is cross-origin (its own localhost port, not the
  // app's), so this is the only way to know which page it's currently
  // showing — vibeco-preview-tracker.js (seeded into every project, see
  // git_ops::bootstrap_empty_repo) posts its path here on load and on every
  // client-side navigation. Checked against the live iframe's own
  // contentWindow, not just origin, so a stale message from a previous
  // preview session (e.g. right after switching target/chat) can't set the
  // wrong page.
  useEffect(() => {
    function handleMessage(e: MessageEvent) {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "vibeco-preview-path" && typeof e.data.path === "string") {
        setCurrentPagePath(e.data.path);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("preview-comments-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_pins" }, (payload) => {
        setPins((prev) => [...prev, payload.new as PreviewPin]);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "preview_pins" }, (payload) => {
        const updated = payload.new as PreviewPin;
        setPins((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "preview_pins" }, (payload) => {
        const row = payload.old as { id: string };
        setPins((prev) => prev.filter((p) => p.id !== row.id));
        setOpenPinId((cur) => (cur === row.id ? null : cur));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_pin_replies" }, (payload) => {
        setReplies((prev) => [...prev, payload.new as PreviewPinReply]);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "preview_pin_replies" }, (payload) => {
        const row = payload.old as { id: string };
        setReplies((prev) => prev.filter((r) => r.id !== row.id));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "preview_strokes" }, (payload) => {
        const row = payload.new as PreviewStroke;
        // Our own strokes are already added optimistically in handleStrokeEnd
        // below — skip the echo so it doesn't render twice.
        setStrokes((prev) => (prev.some((s) => s.id === row.id) ? prev : [...prev, row]));
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "preview_strokes" }, (payload) => {
        const row = payload.old as { id: string };
        setStrokes((prev) => prev.filter((s) => s.id !== row.id));
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  function handleSaveDraftPin(text: string) {
    if (draftPin && text.trim()) {
      // Success needs no local state update here — the realtime subscription
      // above appends the new row once the insert lands.
      insertPreviewPin(draftPin, text.trim(), currentPagePath).catch((err) => {
        console.error("failed to add pin", err);
        showToast("Couldn't save that comment — try again.");
      });
      setPanelOpen(true);
    }
    setDraftPin(null);
    setTool("cursor");
  }

  function handleCancelDraftPin() {
    // Stay on the comment tool — cancelling one note usually means you want
    // to place another, not drop back to the cursor.
    setDraftPin(null);
  }

  function handleMovePin(pinId: string, point: PercentPoint) {
    // Optimistic — the realtime UPDATE subscription above would eventually
    // land the same change, but waiting for that round-trip means the pin
    // visibly snaps back to its old spot for a moment after every drag.
    setPins((prev) => prev.map((p) => (p.id === pinId ? { ...p, x_pct: point.x_pct, y_pct: point.y_pct } : p)));
    movePreviewPin(pinId, point).catch((err) => {
      console.error("failed to move pin", err);
      showToast("Couldn't move that pin — try again.");
    });
  }

  function handleDeletePin(pinId: string) {
    setOpenPinId((cur) => (cur === pinId ? null : cur));
    // Optimistic, same reasoning as handleMovePin — otherwise the pin sits
    // on screen until the realtime DELETE round-trips back.
    setPins((prev) => prev.filter((p) => p.id !== pinId));
    deletePreviewPin(pinId).catch((err) => {
      console.error("failed to delete pin", err);
      showToast("Couldn't delete that comment — try again.");
    });
  }

  function handleStrokeEnd() {
    if (activeStroke && activeStroke.length >= 2) {
      // Optimistic, same reasoning as handleMovePin — otherwise the stroke
      // vanishes the instant the pointer lifts and only reappears once the
      // realtime INSERT round-trips back.
      insertPreviewStroke(activeStroke)
        .then((stroke) => setStrokes((prev) => (prev.some((s) => s.id === stroke.id) ? prev : [...prev, stroke])))
        .catch((err) => {
          console.error("failed to add stroke", err);
          showToast("Couldn't save that drawing — try again.");
        });
    }
    setActiveStroke(null);
  }

  function handleToolChange(newTool: PreviewTool) {
    setTool(newTool);
    setPanelOpen(newTool === "pin");
  }

  function handleUndo() {
    const stroke = lastOwnStroke(strokes, session.user.id);
    if (stroke) {
      setStrokes((prev) => prev.filter((s) => s.id !== stroke.id));
      deletePreviewStroke(stroke.id).catch((err) => console.error("failed to undo stroke", err));
    }
  }

  function handleClear() {
    const ownIds = new Set(strokes.filter((s) => s.created_by === session.user.id).map((s) => s.id));
    if (ownIds.size === 0) return;
    setStrokes((prev) => prev.filter((s) => !ownIds.has(s.id)));
    clearOwnPreviewStrokes(strokes, session.user.id).catch((err) => console.error("failed to clear strokes", err));
  }

  // ── team -> main promotion gate ───────────────────────────────────────────
  const teamSha = shas?.teamSha ?? "";
  const hasSomethingToPromote = !!shas && teamSha !== "" && teamSha !== shas.mainSha;
  // Approvals only count for the exact team commit they were given on — a
  // later merge into team moves the sha and quietly resets the gate.
  const currentApprovals = approvals.filter((a) => a.team_sha === teamSha);
  const approvedIds = new Set(currentApprovals.map((a) => a.approved_by));
  // No roles table yet (see decisions.md) — everyone with a profile must
  // approve. A real permissions feature replaces this.
  const requiredApprovers = profiles;
  const iHaveApproved = approvedIds.has(session.user.id);
  const allApproved = requiredApprovers.length > 0 && requiredApprovers.every((p) => approvedIds.has(p.id));
  const unresolvedCount = pins.filter((p) => !p.resolved).length;
  const commentsClear = unresolvedCount === 0;
  const canPromote = hasSomethingToPromote && commentsClear && allApproved && !promoting;

  function handleApprovePromotion() {
    if (!teamSha || iHaveApproved) return;
    const mine = profiles.find((p) => p.id === session.user.id);
    const name = mine?.display_name || session.user.email || "Someone";
    insertPromotionApproval({ projectId: project.id, teamSha, approvedBy: session.user.id, approverName: name }).catch(
      (err) => {
        console.error("failed to record approval", err);
        showToast("Couldn't record your approval — try again.");
      },
    );
  }

  function handlePromoteToMain() {
    if (!canPromote) return;
    setPromoting(true);
    invoke("promote_to_main")
      .then(async () => {
        // Clear the round: the merged items are in `main` now, and their
        // approvals are spent. Realtime DELETEs echo this to other clients.
        await Promise.allSettled(mergedItems.map((i) => deleteQueueItem(i.id)));
        await clearPromotionApprovals(project.id).catch((e) => console.error("failed to clear approvals", e));
        setMergedItems([]);
        setApprovals([]);
        setPromoteOpen(false);
        showToast("Promoted to main ✓");
        invoke<{ teamSha: string; mainSha: string }>("team_and_main_shas")
          .then(setShas)
          .catch(() => {});
      })
      .catch((err) => {
        console.error("promote_to_main failed", err);
        showToast(
          typeof err === "string" && err.includes("may have moved")
            ? "main moved on — pull latest and retry."
            : "Couldn't promote to main — try again.",
        );
      })
      .finally(() => setPromoting(false));
  }

  return (
    <div className="flex flex-1 min-w-0 min-h-0 gap-3 p-3">
      <div
        className="relative flex-1 min-w-0 bg-chat-pane-bg border border-border rounded-2xl overflow-hidden"
        ref={containerRef}
      >
        <div className="absolute top-3 left-3 z-10 flex items-center gap-[0.2em] bg-bg-tertiary rounded-lg p-[0.2em]">
          <button
            type="button"
            onClick={handleUpdateClick}
            disabled={(previewStatus === "starting" && target !== "team") || pulling}
            title={teamHasUpdate ? "A teammate merged changes — click to pull them in" : "Reload preview"}
            className={`relative flex items-center gap-[0.4em] border-none text-[0.85em] font-medium px-[1.1em] py-[calc(0.2em+2px)] rounded-md transition-colors hover:text-text-primary disabled:opacity-40 disabled:pointer-events-none ${
              teamHasUpdate ? "bg-accent/15 text-accent" : "bg-transparent text-text-secondary"
            }`}
          >
            <RefreshCw className={`w-[1em] h-[1em] ${pulling ? "animate-spin" : ""}`} />
            Update
            {teamHasUpdate && !pulling && (
              <span className="w-[6px] h-[6px] rounded-full bg-accent" aria-hidden="true" />
            )}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              disabled={restarting}
              title="More preview options"
              className="flex items-center border-none bg-transparent text-text-secondary px-[0.55em] py-[calc(0.2em+2px)] rounded-md transition-colors hover:text-text-primary disabled:opacity-40"
            >
              <MoreHorizontal className="w-[1em] h-[1em]" />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-0" onClick={() => setMenuOpen(false)} />
                <div className="absolute left-0 top-[calc(100%+6px)] z-10 min-w-[190px] bg-bg-tertiary border border-border rounded-lg py-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)]">
                  <button
                    type="button"
                    onClick={handleHardRestart}
                    disabled={restarting}
                    className="w-full flex items-center gap-[0.5em] border-none bg-transparent text-left text-[0.85em] text-text-primary px-3 py-2 cursor-pointer hover:bg-bg-secondary disabled:opacity-40"
                  >
                    <RefreshCw className={`w-[1em] h-[1em] ${restarting ? "animate-spin" : ""}`} />
                    {restarting ? "Resetting…" : "Hard reset preview"}
                  </button>
                  <div className="px-3 pt-1 pb-1.5 text-[0.72em] leading-snug text-text-tertiary">
                    Restarts the server and clears the app's saved state, so it
                    loads like a brand-new first visit (onboarding shows again).
                  </div>
                </div>
              </>
            )}
          </div>
          {target === "team" && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setPromoteOpen((o) => !o)}
                title="Promote team to main"
                className={`relative flex items-center gap-[0.4em] border-none text-[0.85em] font-medium px-[1.1em] py-[calc(0.2em+2px)] rounded-md transition-colors hover:text-text-primary ${
                  canPromote ? "bg-merged/15 text-merged" : "bg-transparent text-text-secondary"
                }`}
              >
                <GitMerge className="w-[1em] h-[1em]" />
                Promote
                {hasSomethingToPromote && !canPromote && (
                  <span className="w-[6px] h-[6px] rounded-full bg-held" aria-hidden="true" />
                )}
              </button>
              {promoteOpen && (
                <>
                  <div className="fixed inset-0 z-0" onClick={() => setPromoteOpen(false)} />
                  <div className="absolute left-0 top-[calc(100%+6px)] z-10 w-[280px] bg-bg-tertiary border border-border rounded-lg p-3 shadow-[0_8px_24px_rgba(0,0,0,0.4)] text-[0.82em]">
                    <div className="font-semibold text-text-primary mb-2">Promote team → main</div>
                    {!hasSomethingToPromote ? (
                      <div className="text-text-tertiary leading-snug">
                        Nothing new in <span className="mono">team</span> to promote.
                      </div>
                    ) : (
                      <>
                        <div className="text-text-secondary mb-1.5">
                          {mergedItems.length} {mergedItems.length === 1 ? "change" : "changes"} merged into{" "}
                          <span className="mono">team</span>:
                        </div>
                        <ul className="mb-2.5 space-y-1">
                          {mergedItems.slice(0, 3).map((it) => (
                            <li key={it.id} className="text-text-tertiary truncate">
                              · {it.summary.split("\n")[0].replace(/^#+\s*/, "")}
                            </li>
                          ))}
                          {mergedItems.length > 3 && (
                            <li className="text-text-tertiary">+{mergedItems.length - 3} more</li>
                          )}
                        </ul>
                        <div
                          className={`flex items-center gap-[0.4em] mb-2 ${
                            commentsClear ? "text-merged" : "text-held"
                          }`}
                        >
                          <Check className="w-[1em] h-[1em]" />
                          {commentsClear
                            ? "All comments resolved"
                            : `${unresolvedCount} open comment${unresolvedCount === 1 ? "" : "s"} — resolve to promote`}
                        </div>
                        <div className="text-text-secondary mb-1">Approvals</div>
                        <ul className="space-y-0.5 mb-2.5">
                          {requiredApprovers.map((p) => {
                            const ok = approvedIds.has(p.id);
                            return (
                              <li key={p.id} className="flex items-center justify-between">
                                <span className="text-text-tertiary truncate">
                                  {p.display_name || p.email}
                                </span>
                                <span className={ok ? "text-merged" : "text-text-tertiary"}>
                                  {ok ? "approved" : "waiting"}
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                        {!iHaveApproved && (
                          <button
                            type="button"
                            onClick={handleApprovePromotion}
                            className="w-full mb-1.5 border border-border rounded-md py-1.5 text-text-primary hover:bg-bg-secondary transition-colors"
                          >
                            Approve
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handlePromoteToMain}
                          disabled={!canPromote}
                          className="w-full border-none rounded-md py-1.5 font-medium bg-merged/20 text-merged hover:bg-merged/30 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        >
                          {promoting ? "Promoting…" : "Promote to main"}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
        {previewStatus === "ready" ? (
          <>
            {viewport === "mobile" ? (
              <div className="w-full h-full overflow-auto flex items-center justify-center py-6">
                <div
                  className="relative bg-black rounded-[40px] p-[10px] shadow-2xl shrink-0"
                  style={{ width: 300 + 20, height: 650 + 20 }}
                >
                  <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[96px] h-[22px] bg-black rounded-b-[14px] z-10" />
                  <iframe
                    key={reloadKey}
                    ref={iframeRef}
                    onLoad={handleIframeLoad}
                    className="w-full h-full border-none block rounded-[30px] bg-white"
                    src={target === "team" ? TEAM_PREVIEW_URL : `http://localhost:${localPort}`}
                    aria-label={target === "team" ? "Live team preview (mobile)" : "Live local chat preview (mobile)"}
                  />
                </div>
              </div>
            ) : (
              <iframe
                key={reloadKey}
                ref={iframeRef}
                onLoad={handleIframeLoad}
                className="w-full h-full border-none block"
                src={target === "team" ? TEAM_PREVIEW_URL : `http://localhost:${localPort}`}
                aria-label={target === "team" ? "Live team preview" : "Live local chat preview"}
              />
            )}
            <PreviewAnnotationLayer
              containerRef={containerRef}
              tool={tool}
              pins={pinsOnPage(pins, currentPagePath)}
              strokes={strokes}
              activeStroke={activeStroke}
              draftPin={draftPin}
              openPinId={openPinId}
              repliesByPin={repliesByPin(replies)}
              currentUserId={session.user.id}
              profiles={profiles}
              onPlacePin={setDraftPin}
              onSaveDraftPin={handleSaveDraftPin}
              onCancelDraftPin={handleCancelDraftPin}
              onStrokeStart={(point) => setActiveStroke([point])}
              onStrokePoint={(point) => setActiveStroke((prev) => (prev ? [...prev, point] : [point]))}
              onStrokeEnd={handleStrokeEnd}
              onPinClick={(pinId) => setOpenPinId((cur) => (cur === pinId ? null : pinId))}
              onMovePin={handleMovePin}
              onClosePopover={() => setOpenPinId(null)}
              onResolvePin={(pinId, resolved) => setPinResolved(pinId, resolved).catch((err) => console.error("failed to update pin", err))}
              onDeletePin={handleDeletePin}
              onReplyPin={(pinId, text) => insertPreviewPinReply(pinId, text).catch((err) => console.error("failed to add reply", err))}
            />
            <PreviewToolbar
              tool={tool}
              onToolChange={handleToolChange}
              onUndo={handleUndo}
              canUndo={lastOwnStroke(strokes, session.user.id) !== null}
              onClear={handleClear}
              canClear={strokes.some((s) => s.created_by === session.user.id)}
            />
            {panelOpen && (
              <PreviewCommentPanel
                pins={visiblePins(pins, showResolved)}
                repliesByPin={repliesByPin(replies)}
                currentUserId={session.user.id}
                profiles={profiles}
                showResolved={showResolved}
                onToggleShowResolved={() => setShowResolved((s) => !s)}
                onResolve={(pinId, resolved) => setPinResolved(pinId, resolved).catch((err) => console.error("failed to update pin", err))}
                onDelete={handleDeletePin}
                onReply={(pinId, text) => insertPreviewPinReply(pinId, text).catch((err) => console.error("failed to add reply", err))}
              />
            )}
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-[12px] tracking-[0.05em] text-text-tertiary">
            {previewStatus === "starting"
              ? "Starting preview…"
              : target === "local" && !activeChatId
                ? "Select a chat to preview its local changes."
                : "Couldn't start the preview server."}
          </div>
        )}
        <div className="absolute bottom-3 left-3">
          <PillToggle
            items={[
              { key: "team", label: "Team" },
              { key: "local", label: "Local" },
            ]}
            active={target}
            onChange={setTarget}
          />
        </div>
        <div className="absolute bottom-3 right-3">
          <PillToggle
            items={[
              { key: "desktop", label: "Desktop", title: "Desktop view" },
              { key: "mobile", label: "Mobile", title: "Mobile view" },
            ]}
            active={viewport}
            onChange={setViewport}
          />
        </div>
      </div>
    </div>
  );
}
