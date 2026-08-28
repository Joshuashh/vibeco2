import type { PreviewPin, PreviewPinReply } from "../lib/previewComments";
import type { Profile } from "../lib/profiles";
import { CommentThread, DeleteButton, ResolveButton } from "./previewCommentUi";

// pillBase pattern kept local per Task 7's precedent. This is the last
// consumer of .pill/.pill-ghost — see decisions.md for the App.css cleanup
// this enabled.
const pillGhost =
  "appearance-none border-0 outline-none box-border inline-flex items-center gap-[0.35em] text-[0.78em] px-[0.7em] py-[0.4em] rounded-lg cursor-default text-text-secondary bg-transparent hover:bg-bg-tertiary transition-colors";

export function PreviewCommentPanel({
  pins,
  repliesByPin,
  currentUserId,
  profiles,
  showResolved,
  onToggleShowResolved,
  onResolve,
  onDelete,
  onReply,
}: {
  pins: PreviewPin[];
  repliesByPin: Record<string, PreviewPinReply[]>;
  currentUserId: string;
  profiles: Profile[];
  showResolved: boolean;
  onToggleShowResolved: () => void;
  onResolve: (pinId: string, resolved: boolean) => void;
  onDelete: (pinId: string) => void;
  onReply: (pinId: string, text: string) => void;
}) {
  const sorted = [...pins].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return (
    // A floating card over the preview, not a flex sibling — a sibling that
    // shrinks the iframe would resize the (responsive) page inside, reflowing
    // its content and leaving every pin pointing at the wrong spot the moment
    // this panel opens. Inset on all sides so it reads as detached.
    <div className="absolute top-3 right-3 bottom-3 z-20 w-[320px] rounded-lg border border-border bg-bg-sidebar flex flex-col overflow-hidden shadow-[0_2px_16px_rgba(0,0,0,0.1)]">
      <div className="flex items-center justify-between px-3.5 py-3 border-b border-border text-[13px] font-semibold text-text-primary">
        <span>Comments</span>
        <button type="button" className={pillGhost} onClick={onToggleShowResolved}>
          {showResolved ? "Hide resolved" : "Show resolved"}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2.5 flex flex-col gap-2.5">
        {sorted.length === 0 && (
          <div className="text-text-tertiary text-[12px] leading-[1.5] p-[1em]">
            No comments yet — pick the comment tool on the toolbar and click the preview to leave one.
          </div>
        )}
        {sorted.map((pin) => (
          // Boxed like a queue item (ShelfPanel) — a bordered card per comment
          // so a wall of pins stays easy to tell apart.
          <div
            key={pin.id}
            className={`rounded-xl border border-border bg-bg-tertiary p-3 transition-opacity ${
              pin.resolved ? "opacity-60" : ""
            }`}
          >
            <CommentThread
              pin={pin}
              replies={repliesByPin[pin.id] ?? []}
              profiles={profiles}
              currentUserId={currentUserId}
              onReply={onReply}
              actions={
                <>
                  <ResolveButton resolved={pin.resolved} onClick={() => onResolve(pin.id, !pin.resolved)} />
                  <DeleteButton onClick={() => onDelete(pin.id)} />
                </>
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
