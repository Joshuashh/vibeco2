import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

// Model/effort/permission-mode are app-wide preferences (one selection you
// set once), not per-chat — every open pane reads and writes the same
// values, and every new session picks them up. Backed by localStorage so
// they survive a restart.

export type ModelOption = { label: string; cliValue: string; requiresCredits?: boolean };
export type EffortOption = { label: string; cliValue: string };
export type PermissionOption = { label: string; cliValue: string };

// The four current models — CLI-recognized aliases per `claude --help`.
export const MODELS: ModelOption[] = [
  { label: "Fable 5", cliValue: "fable", requiresCredits: true },
  { label: "Opus 5", cliValue: "opus" },
  { label: "Sonnet 5", cliValue: "sonnet" },
  { label: "Haiku 4.5", cliValue: "haiku" },
];
// Older models have no CLI alias — only a full model name works, and we
// don't have a verified list of those, so these pass a best-effort slug
// through. Picking one that doesn't resolve surfaces as a normal
// "Couldn't start the Claude session" error rather than failing silently.
export const MORE_MODELS: ModelOption[] = ["Opus 4.8", "Opus 4.7", "Opus 4.6", "Sonnet 4.6"].map((label) => ({
  label,
  cliValue: label.toLowerCase().replace(/\s+/g, "-"),
}));

export const EFFORTS: EffortOption[] = [
  { label: "Low", cliValue: "low" },
  { label: "Medium", cliValue: "medium" },
  { label: "High", cliValue: "high" },
  { label: "X-High", cliValue: "xhigh" },
  { label: "Max", cliValue: "max" },
];

export const PERMISSIONS: PermissionOption[] = [
  { label: "Manual", cliValue: "manual" },
  { label: "Accept edits", cliValue: "acceptEdits" },
  { label: "Plan", cliValue: "plan" },
  { label: "Auto", cliValue: "auto" },
];

export type Theme = "dark" | "light";

interface Prefs {
  model: ModelOption;
  setModel: (m: ModelOption) => void;
  effort: EffortOption;
  setEffort: (e: EffortOption) => void;
  permission: PermissionOption;
  setPermission: (p: PermissionOption) => void;
  bypassPermissions: boolean;
  setBypassPermissions: (b: boolean) => void;
  // What actually goes on the CLI invocation: bypass overrides whatever
  // mode is selected, without losing/forgetting that selection.
  effectivePermissionMode: string;
  theme: Theme;
  setTheme: (t: Theme) => void;
}

const PrefsContext = createContext<Prefs | null>(null);

function useStoredOption<T extends { label: string }>(key: string, options: T[], fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const storedLabel = localStorage.getItem(key);
    return options.find((o) => o.label === storedLabel) ?? fallback;
  });
  useEffect(() => {
    localStorage.setItem(key, value.label);
  }, [key, value]);
  return [value, setValue];
}

// The first model that doesn't need paid usage credits — the safe default.
// Never auto-select a credits-gated model (e.g. Fable 5): with no credits,
// every message fails with a 429 the chat currently doesn't surface, so it
// just looks dead. See InputToolbelt's "Requires usage credits" badge.
const DEFAULT_MODEL: ModelOption = MODELS.find((m) => !m.requiresCredits) ?? MODELS[0];

// Model needs its own resolver (not the generic useStoredOption): a persisted
// gated model is only honored when the user *explicitly* picked it. The old
// silent default (Fable 5) was written to localStorage on first load without
// any real choice, so we bump that back to DEFAULT_MODEL; an explicit pick
// (tracked via the :explicit flag, set only from setModel) is always kept.
function useStoredModel(): [ModelOption, (m: ModelOption) => void] {
  const all = [...MODELS, ...MORE_MODELS];
  const [model, setModelState] = useState<ModelOption>(() => {
    const stored = all.find((o) => o.label === localStorage.getItem("vibeco:model"));
    if (!stored) return DEFAULT_MODEL;
    const explicit = localStorage.getItem("vibeco:model:explicit") === "true";
    return stored.requiresCredits && !explicit ? DEFAULT_MODEL : stored;
  });
  useEffect(() => {
    localStorage.setItem("vibeco:model", model.label);
  }, [model]);
  const setModel = (m: ModelOption) => {
    localStorage.setItem("vibeco:model:explicit", "true");
    setModelState(m);
  };
  return [model, setModel];
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [model, setModel] = useStoredModel();
  const [effort, setEffort] = useStoredOption("vibeco:effort", EFFORTS, EFFORTS[0]);
  const [permission, setPermission] = useStoredOption("vibeco:permission", PERMISSIONS, PERMISSIONS[0]);
  const [bypassPermissions, setBypassPermissions] = useState(
    () => localStorage.getItem("vibeco:bypassPermissions") === "true"
  );
  useEffect(() => {
    localStorage.setItem("vibeco:bypassPermissions", String(bypassPermissions));
  }, [bypassPermissions]);

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("vibeco:theme") as Theme | null) ?? "dark"
  );
  useEffect(() => {
    localStorage.setItem("vibeco:theme", theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const value: Prefs = {
    model,
    setModel,
    effort,
    setEffort,
    permission,
    setPermission,
    bypassPermissions,
    setBypassPermissions,
    effectivePermissionMode: bypassPermissions ? "bypassPermissions" : permission.cliValue,
    theme,
    setTheme,
  };

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error("usePrefs must be used within PrefsProvider");
  return ctx;
}
