import * as RadixPopover from "@radix-ui/react-popover";
import type { RefObject } from "react";

/**
 * Chrome-free floating menu anchored to a trigger element. Built on Radix's
 * Popover primitive, which handles edge-avoidance/collision flipping.
 */
export function Popover({
  open,
  onClose,
  anchorRef,
  width,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  width: number;
  children: React.ReactNode;
}) {
  return (
    <RadixPopover.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <RadixPopover.Anchor virtualRef={anchorRef} />
      <RadixPopover.Portal>
        <RadixPopover.Content
          className="bg-bg-tertiary border border-border rounded-lg py-1 shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-[100]"
          style={{ width }}
          side="bottom"
          align="start"
          sideOffset={4}
          collisionPadding={8}
          avoidCollisions
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  );
}

export function PopoverHeader({ title }: { title: string }) {
  return <div className="text-[11px] font-semibold text-text-tertiary px-3.5 pt-2.5 pb-1">{title}</div>;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function PopoverRow({
  title,
  shortcut = "",
  checked = false,
  badge,
  chevron = false,
  indent = false,
  tint,
  onClick,
}: {
  title: string;
  shortcut?: string;
  checked?: boolean;
  badge?: string;
  chevron?: boolean;
  indent?: boolean;
  tint?: "purple";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`appearance-none bg-transparent border-0 outline-none font-normal text-left box-border flex items-center w-[calc(100%-8px)] mx-1 my-0 py-[7px] px-2.5 rounded-md text-[13px] cursor-default hover:bg-[rgba(236,236,236,0.08)] ${
        indent ? "pl-6" : ""
      }`}
      onClick={onClick}
    >
      <span className={tint ? "text-[#a855f7]" : "text-text-primary"}>{title}</span>
      {badge && (
        <span
          className="text-[10px] font-medium text-accent px-1.5 py-0.5 rounded-full ml-1.5"
          style={{ background: "var(--accent-dim)" }}
        >
          {badge}
        </span>
      )}
      <span className="flex-1" />
      {checked ? (
        <span className="flex w-[11px] h-[11px] text-text-primary [&>svg]:w-full [&>svg]:h-full">
          <CheckIcon />
        </span>
      ) : chevron ? (
        <span className="flex w-2.5 h-2.5 text-text-tertiary [&>svg]:w-full [&>svg]:h-full">
          <ChevronIcon />
        </span>
      ) : shortcut ? (
        <span className="text-xs text-text-tertiary">{shortcut}</span>
      ) : null}
    </button>
  );
}

export function PopoverDivider() {
  return <div className="h-px bg-border my-1" />;
}
