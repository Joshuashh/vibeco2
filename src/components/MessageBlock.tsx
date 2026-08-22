import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Attachment, ContentBlock } from "../types/message";
import { AttachmentLightbox, AttachmentFileIcon } from "./AttachmentLightbox";
import { useSmoothedText } from "../lib/useSmoothedText";
import { formatRelativeTimeLong } from "../lib/time";
import { colorForUser } from "../lib/presenceColor";
import { MENTION_RE } from "../lib/mentions";
import type { AssignableTeammate } from "./AssignChatMenu";

// Colors an "@name" run in its own color when it matches a real teammate —
// leaves any other "@word" (a stray typed symbol, not a real mention) as
// plain text.
function renderMentionedText(text: string, teammates: AssignableTeammate[]): ReactNode {
  if (teammates.length === 0) return text;
  const emailByName = new Map(teammates.map((t) => [t.email.split("@")[0].toLowerCase(), t.email]));
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MENTION_RE)) {
    const email = emailByName.get(match[1].toLowerCase());
    if (!email) continue;
    const start = match.index ?? 0;
    if (start > lastIndex) parts.push(text.slice(lastIndex, start));
    parts.push(
      <span key={start} style={{ color: colorForUser(email) }} className="font-medium">
        @{match[1]}
      </span>
    );
    lastIndex = start + match[0].length;
  }
  if (lastIndex === 0) return text;
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

function MessageAttachment({ attachment }: { attachment: Attachment }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const isImage = attachment.mimeType.startsWith("image/");

  return (
    <>
      <button
        type="button"
        onClick={() => setPreviewOpen(true)}
        title="Preview"
        className="appearance-none border-0 outline-none bg-transparent p-0 cursor-pointer inline-flex items-center gap-[0.5em] text-[0.85em] text-text-secondary bg-bg-secondary pr-[0.7em] py-[0.3em] pl-[0.3em] rounded-lg mb-[0.4em]"
      >
        {isImage ? (
          <img src={attachment.url} alt={attachment.name} className="w-8 h-8 rounded object-cover shrink-0" />
        ) : (
          <span className="flex w-8 h-8 items-center justify-center shrink-0 text-text-tertiary [&>svg]:w-4 [&>svg]:h-4">
            <AttachmentFileIcon />
          </span>
        )}
        {attachment.name}
      </button>
      {previewOpen && (
        <AttachmentLightbox
          item={{ name: attachment.name, mimeType: attachment.mimeType }}
          url={attachment.url}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

function CodeBlock({ language, source }: { language: string; source: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="bg-bg-secondary border border-border rounded-lg mb-[0.7em] overflow-hidden">
      <div className="flex items-center justify-between px-[10px] py-[6px] border-b border-border">
        <span className="text-[11px] text-text-tertiary">{language || "code"}</span>
        <button
          type="button"
          className="text-[11px] text-text-tertiary bg-transparent border-none cursor-pointer p-0 hover:text-text-primary"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(source);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="m-0 px-[1em] py-[0.8em] overflow-x-auto">
        <code className="bg-transparent p-0 text-[12px]">{source}</code>
      </pre>
    </div>
  );
}

export function MarkdownText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      <ReactMarkdown
        components={{
          code({ className, children }) {
            const match = /language-(\w+)/.exec(className ?? "");
            if (!match) return <code>{children}</code>;
            return <CodeBlock language={match[1]} source={String(children).replace(/\n$/, "")} />;
          },
          pre({ children }) {
            return <>{children}</>;
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

export type Diff = { removed: string | null; added: string | null };

export function diffStats(diff: Diff | null): { added: number; removed: number } {
  if (!diff) return { added: 0, removed: 0 };
  return {
    added: diff.added ? diff.added.split("\n").length : 0,
    removed: diff.removed ? diff.removed.split("\n").length : 0,
  };
}

export function describeTool(
  name: string,
  input: unknown
): { summary: string; file: string | null; fullPath: string | null; diff: Diff | null } {
  const record = (input ?? {}) as Record<string, unknown>;
  const filePath = record.file_path != null ? String(record.file_path) : null;
  switch (name) {
    case "Read":
      return { summary: "Read", file: filePath && basename(filePath), fullPath: filePath, diff: null };
    case "Write":
      return {
        summary: "Write",
        file: filePath && basename(filePath),
        fullPath: filePath,
        diff: { removed: null, added: String(record.content ?? "") },
      };
    case "Edit":
      return {
        summary: "Edit",
        file: filePath && basename(filePath),
        fullPath: filePath,
        diff: { removed: String(record.old_string ?? ""), added: String(record.new_string ?? "") },
      };
    case "Bash":
      return { summary: `Ran: ${String(record.command ?? "")}`, file: null, fullPath: null, diff: null };
    default:
      return { summary: name, file: null, fullPath: null, diff: null };
  }
}

export function DiffView({ diff }: { diff: Diff }) {
  return (
    <div className="font-[SF_Mono,monospace] text-[12px] rounded-lg overflow-hidden mt-[0.5em] max-h-[220px] overflow-y-auto">
      {diff.removed &&
        diff.removed.split("\n").map((line, i) => (
          <div key={`r${i}`} className="bg-conflict/10 text-conflict px-[0.9em] py-[0.1em] whitespace-pre-wrap">
            − {line}
          </div>
        ))}
      {diff.added &&
        diff.added.split("\n").map((line, i) => (
          <div key={`a${i}`} className="bg-merged/10 text-merged px-[0.9em] py-[0.1em] whitespace-pre-wrap">
            + {line}
          </div>
        ))}
    </div>
  );
}

type ToolUseBlock = Extract<ContentBlock, { kind: "tool_use" }>;

export function ToolCallRow({ block }: { block: ToolUseBlock }) {
  const [expanded, setExpanded] = useState(false);

  const { summary, file, fullPath, diff } = describeTool(block.name, block.input);
  const hasDiff = Boolean(diff && (diff.removed || diff.added));
  const hasDetail = hasDiff || Boolean(block.result?.content);

  return (
    <div>
      <div
        className={`flex items-center gap-[0.5em] min-w-0 text-[13px] text-text-tertiary ${hasDetail ? "cursor-default" : ""}`}
        onClick={() => hasDetail && setExpanded((e) => !e)}
      >
        {block.result == null ? (
          <span className="flex w-[14px] h-[14px] shrink-0 text-accent">
            <span className="text-[12px]">✻</span>
          </span>
        ) : (
          <span
            className={`flex w-[14px] h-[14px] shrink-0 [&>svg]:w-full [&>svg]:h-full ${
              block.result.isError ? "text-conflict" : "text-text-tertiary"
            }`}
          >
            {block.result.isError ? (
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
            )}
          </span>
        )}
        <span
          title={block.name === "Bash" ? summary : undefined}
          className={block.name === "Bash" ? "truncate" : "shrink-0"}
        >
          {summary}
        </span>
        {file && (
          <span
            title={fullPath ?? undefined}
            className="font-[SF_Mono,monospace] text-[12px] text-text-secondary bg-bg-secondary px-[0.5em] py-[0.15em] rounded-[5px] truncate"
          >
            {file}
          </span>
        )}
        {hasDetail && (
          <span className={`shrink-0 text-text-tertiary transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}>
            ›
          </span>
        )}
      </div>
      {expanded && hasDiff && diff && <DiffView diff={diff} />}
      {expanded && !hasDiff && block.result && (
        <pre className="font-[SF_Mono,monospace] text-[12px] text-text-secondary bg-bg-secondary px-[0.9em] py-[0.7em] rounded-lg m-0 mt-[0.5em] whitespace-pre-wrap max-h-[220px] overflow-y-auto">
          {block.result.content}
        </pre>
      )}
    </div>
  );
}

export function MessageBlock({
  block,
  markdown = false,
  live = false,
  createdAt,
  teammates = [],
}: {
  block: ContentBlock;
  markdown?: boolean;
  // True only for the trailing text block of the message currently
  // streaming — trickles newly-arrived text in instead of snapping each
  // delta straight onto the page. See lib/useSmoothedText.ts.
  live?: boolean;
  // Only used by the handoff_brief branch — other block kinds show a
  // timestamp via the message-level hover tooltip instead.
  createdAt?: string;
  // Used to color a real @mention in the sender's own presence color —
  // only meaningful for plain-text (user) blocks, see below.
  teammates?: AssignableTeammate[];
}) {
  const smoothedText = useSmoothedText(block.kind === "text" ? block.text : "", live);

  if (block.kind === "text") {
    const text = live ? smoothedText : block.text;
    // Matches the sibling Claude Code GUI: only assistant text is rendered as
    // markdown (MarkdownText.swift) — user bubbles show plain text there too.
    return markdown ? (
      <MarkdownText text={text} className="markdown text-[14px] leading-[1.6] mt-0 mb-[0.4em] last:mb-0" />
    ) : (
      <p className="text-[14px] leading-[1.6] m-0">{renderMentionedText(text, teammates)}</p>
    );
  }

  if (block.kind === "attachment") {
    return <MessageAttachment attachment={block} />;
  }

  if (block.kind === "handoff_brief") {
    const label = block.briefKind === "handoff" ? `Handed off to ${block.handedOffTo ?? "teammate"}` : "Auto-checkpoint";
    return (
      <div className="border border-border rounded-lg px-[1em] py-[0.8em] mt-[0.4em] mb-[0.4em] bg-bg-secondary">
        <div className="flex items-center justify-between gap-[1em] mb-[0.5em]">
          <div className="text-[11px] uppercase tracking-wide text-text-tertiary">{label}</div>
          {createdAt && <div className="text-[11px] text-text-tertiary shrink-0">{formatRelativeTimeLong(createdAt)}</div>}
        </div>
        <MarkdownText text={block.text} className="markdown text-[14px] leading-[1.6]" />
      </div>
    );
  }

  if (block.kind === "tool_use") {
    return (
      <div className="mt-[0.6em] mb-[0.6em]">
        <ToolCallRow block={block} />
      </div>
    );
  }

  return null;
}
