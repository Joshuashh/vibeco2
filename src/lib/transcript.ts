import type { Message } from "../types/message";

/**
 * Serializes prior turns into a short context preamble for a *new* CLI
 * session that isn't a native `--resume` of the original one (see
 * decisions.md: native resume only works for whoever's machine/account
 * created it). Tool results are named, not dumped, to keep this cheap.
 */
export function buildTranscriptPreamble(messages: Message[]): string {
  if (messages.length === 0) return "";

  const lines = messages.map((message) => {
    const label = message.role === "user" ? "User" : "Assistant";
    const parts = message.blocks.map((block) =>
      block.kind === "text" ? block.text : `[used tool: ${block.name}]`
    );
    return `${label}: ${parts.join(" ")}`;
  });

  return [
    "[Continuing a shared conversation someone else started. Here is the prior context:]",
    "",
    ...lines,
    "",
    "[End of prior context. Continue from here.]",
  ].join("\n");
}
