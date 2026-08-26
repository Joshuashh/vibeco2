import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { colorForUser } from "../lib/presenceColor";

export interface AssignableTeammate {
  email: string;
  displayName: string | null;
  online: boolean;
}

// Manual assignment, distinct from "claiming" (which only tracks who's
// actively working right now, via Liveblocks presence, and only covers
// whoever's currently online). This lets you hand a chat to anyone on the
// team regardless of whether they're online — generates the same handoff
// brief as the canvas card's flow, just reachable from a visible control
// instead of a menu item, and from the chat pane too.
export function AssignChatMenu({
  assignedTo,
  teammates,
  onAssign,
  onUnassign,
}: {
  assignedTo: string | null;
  teammates: AssignableTeammate[];
  onAssign: (email: string) => Promise<void>;
  onUnassign?: () => Promise<void>;
}) {
  // Brief generation is a real LLM call — a few seconds is normal, not
  // broken. Without this the button just sat there looking unresponsive
  // until the assignment suddenly appeared.
  const [assigning, setAssigning] = useState(false);

  function handleAssign(email: string) {
    setAssigning(true);
    onAssign(email).finally(() => setAssigning(false));
  }

  // Unassigning is a plain DB write, not a handoff — no brief, no logbook
  // entry, no notification to anyone. Deliberately not routed through
  // handleAssign/onAssign.
  function handleUnassign() {
    if (!onUnassign) return;
    setAssigning(true);
    onUnassign().finally(() => setAssigning(false));
  }

  const assignedTeammate = teammates.find((t) => t.email === assignedTo);
  const assignedLabel = assignedTeammate?.displayName ?? assignedTo;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={assigning}
          className="flex items-center gap-[0.4em] text-[12px] text-text-secondary bg-transparent border border-border rounded-md px-[0.7em] py-[0.3em] cursor-pointer max-w-[160px] transition-colors hover:bg-bg-tertiary hover:text-text-primary disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent"
          title={assigning ? "Generating handoff brief…" : assignedTo ? `Assigned to ${assignedLabel}` : "Assign this chat to a teammate"}
        >
          {assigning ? (
            <span className="w-2 h-2 rounded-full shrink-0 border border-text-tertiary border-t-transparent animate-spin" />
          ) : (
            assignedTo && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorForUser(assignedTo) }} />
          )}
          <span className="truncate">{assigning ? "Generating brief…" : (assignedLabel ?? "Assign…")}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Assign to</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {assignedTo && onUnassign && (
          <>
            <DropdownMenuItem onSelect={handleUnassign}>Unassign</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {teammates.length === 0 && <DropdownMenuItem disabled>No teammates yet</DropdownMenuItem>}
        {teammates.map((teammate) => (
          <DropdownMenuItem key={teammate.email} onSelect={() => handleAssign(teammate.email)}>
            <span
              className="w-2 h-2 rounded-full shrink-0 mr-[0.5em]"
              style={{ background: teammate.online ? colorForUser(teammate.email) : "var(--text-tertiary)" }}
            />
            {teammate.displayName ?? teammate.email}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
