import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface SlashCommand {
  name: string;
  description: string;
  source: "claude" | "custom";
}

// Verified via `claude --print "/<name>"` to be real commands the CLI
// recognizes in --print mode (see decisions.md) — not an exhaustive list of
// every command Claude Code ships, just the common, safe-to-surface ones.
export const BUILTIN_COMMANDS: SlashCommand[] = [
  { name: "clear", description: "Clear conversation history", source: "claude" },
  { name: "compact", description: "Compact the conversation, keeping a summary", source: "claude" },
  { name: "context", description: "Show current context/token usage", source: "claude" },
  { name: "cost", description: "Show cost and usage for this session", source: "claude" },
  { name: "model", description: "Switch the current model", source: "claude" },
  { name: "review", description: "Review a pull request", source: "claude" },
  { name: "init", description: "Generate a CLAUDE.md for this codebase", source: "claude" },
];

// Custom commands the user or this project has defined as .md files under
// ~/.claude/commands and <repo>/.claude/commands.
export function useCustomSlashCommands(): SlashCommand[] {
  const [commands, setCommands] = useState<SlashCommand[]>([]);
  useEffect(() => {
    invoke<{ name: string; description: string }[]>("list_custom_slash_commands")
      .then((list) => setCommands(list.map((c) => ({ ...c, source: "custom" as const }))))
      .catch((err) => console.error("list_custom_slash_commands failed", err));
  }, []);
  return commands;
}
