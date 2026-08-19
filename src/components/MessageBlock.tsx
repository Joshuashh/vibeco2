import { useState } from "react";
import ReactMarkdown from "react-markdown";
import type { ContentBlock } from "../types/message";

function CodeBlock({ language, source }: { language: string; source: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="bg-bg-secondary border border-border rounded-lg mb-[0.7em] overflow-hidden">
      <div className="flex items-center justify-between px-[10px] py-[6px] border-b border-border">
        <span className="text-[11px] text-text-tertiary">{language || "code"}</span>
        <button
          type="button"
          className="text-[11px] text-text-tertiary bg-transparent border-none cursor-pointer p-0 hover:text-text-primary"
          onClick={() => {
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

function describeTool(name: string, input: unknown): { summary: string; file: string | null } {
  const record = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "Read":
      return { summary: "Read", file: String(record.file_path ?? "") };
    case "Write":
      return { summary: "Write", file: String(record.file_path ?? "") };
    case "Edit":
      return { summary: "Edit", file: String(record.file_path ?? "") };
    case "Bash":
      return { summary: `Ran: ${String(record.command ?? "")}`, file: null };
    default:
      return { summary: name, file: null };
  }
}

export function MessageBlock({ block, markdown = false }: { block: ContentBlock; markdown?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (block.kind === "text") {
    // Matches the sibling Claude Code GUI: only assistant text is rendered as
    // markdown (MarkdownText.swift) — user bubbles show plain text there too.
    return markdown ? (
      <div className="markdown text-[14px] leading-[1.6] mt-0 mb-[0.4em] last:mb-0">
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
          {block.text}
        </ReactMarkdown>
      </div>
    ) : (
      <p className="text-[14px] leading-[1.6] m-0">{block.text}</p>
    );
  }

  const { summary, file } = describeTool(block.name, block.input);
  const hasDetail = Boolean(block.result?.content);

  return (
    <div className="mt-[0.6em]">
      <div
        className={`flex items-center gap-[0.5em] text-[13px] text-text-tertiary ${hasDetail ? "cursor-default" : ""}`}
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
        <span>{summary}</span>
        {file && (
          <span className="font-[SF_Mono,monospace] text-[12px] text-text-secondary bg-bg-secondary px-[0.5em] py-[0.15em] rounded-[5px]">
            {file}
          </span>
        )}
        {hasDetail && (
          <span className={`text-text-tertiary transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}>
            ›
          </span>
        )}
      </div>
      {expanded && block.result && (
        <pre className="font-[SF_Mono,monospace] text-[12px] text-text-secondary bg-bg-secondary px-[0.9em] py-[0.7em] rounded-lg m-0 mt-[0.5em] whitespace-pre-wrap max-h-[220px] overflow-y-auto">
          {block.result.content}
        </pre>
      )}
    </div>
  );
}
