import { supabase } from "./supabase";
import type { PercentPoint } from "./overlayGeometry";

export interface PreviewPin {
  id: string;
  x_pct: number;
  y_pct: number;
  text: string;
  resolved: boolean;
  created_by: string;
  created_at: string;
  page_path: string | null;
}

export interface PreviewPinReply {
  id: string;
  pin_id: string;
  text: string;
  created_by: string;
  created_at: string;
}

export interface PreviewStroke {
  id: string;
  path: { x_pct: number; y_pct: number }[];
  created_by: string;
  created_at: string;
}

/** Resolved-hide-by-default filtering for the comment panel (spec §5). */
export function visiblePins(pins: PreviewPin[], showResolved: boolean): PreviewPin[] {
  return showResolved ? pins : pins.filter((p) => !p.resolved);
}

/** Which pins to render as on-screen markers for the page currently showing
 * in the preview iframe. A pin with no page_path (created before this
 * feature, or on a project that never wired up the tracking script) always
 * shows rather than becoming invisible; `currentPath === null` means we
 * haven't heard from the tracker at all yet, so nothing can be filtered out. */
export function pinsOnPage(pins: PreviewPin[], currentPath: string | null): PreviewPin[] {
  if (currentPath === null) return pins;
  return pins.filter((p) => !p.page_path || p.page_path === currentPath);
}

/** Undo only ever removes the current user's own most recent stroke (spec §4). */
export function lastOwnStroke(strokes: PreviewStroke[], userId: string): PreviewStroke | null {
  const own = strokes.filter((s) => s.created_by === userId);
  if (own.length === 0) return null;
  return own.reduce((latest, s) => (s.created_at > latest.created_at ? s : latest));
}

export function repliesByPin(replies: PreviewPinReply[]): Record<string, PreviewPinReply[]> {
  const map: Record<string, PreviewPinReply[]> = {};
  for (const reply of replies) {
    (map[reply.pin_id] ??= []).push(reply);
  }
  return map;
}

export async function fetchPreviewPins(): Promise<PreviewPin[]> {
  const { data, error } = await supabase.from("preview_pins").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch preview pins: ${error.message}`);
  return (data ?? []) as PreviewPin[];
}

export async function fetchPreviewPinReplies(): Promise<PreviewPinReply[]> {
  const { data, error } = await supabase
    .from("preview_pin_replies")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch preview pin replies: ${error.message}`);
  return (data ?? []) as PreviewPinReply[];
}

export async function fetchPreviewStrokes(): Promise<PreviewStroke[]> {
  const { data, error } = await supabase.from("preview_strokes").select("*").order("created_at", { ascending: true });
  if (error) throw new Error(`failed to fetch preview strokes: ${error.message}`);
  return (data ?? []) as PreviewStroke[];
}

export async function insertPreviewPin(point: PercentPoint, text: string, pagePath: string | null): Promise<void> {
  const { error } = await supabase
    .from("preview_pins")
    .insert({ x_pct: point.x_pct, y_pct: point.y_pct, text, page_path: pagePath });
  if (error) throw new Error(`failed to add pin: ${error.message}`);
}

export async function insertPreviewPinReply(pinId: string, text: string): Promise<void> {
  const { error } = await supabase.from("preview_pin_replies").insert({ pin_id: pinId, text });
  if (error) throw new Error(`failed to add reply: ${error.message}`);
}

export async function setPinResolved(pinId: string, resolved: boolean): Promise<void> {
  const { error } = await supabase.from("preview_pins").update({ resolved }).eq("id", pinId);
  if (error) throw new Error(`failed to update pin: ${error.message}`);
}

export async function deletePreviewPin(pinId: string): Promise<void> {
  const { error } = await supabase.from("preview_pins").delete().eq("id", pinId);
  if (error) throw new Error(`failed to delete pin: ${error.message}`);
}

export async function movePreviewPin(pinId: string, point: PercentPoint): Promise<void> {
  const { error } = await supabase
    .from("preview_pins")
    .update({ x_pct: point.x_pct, y_pct: point.y_pct })
    .eq("id", pinId);
  if (error) throw new Error(`failed to move pin: ${error.message}`);
}

export async function insertPreviewStroke(path: PercentPoint[]): Promise<PreviewStroke> {
  const { data, error } = await supabase.from("preview_strokes").insert({ path }).select().single();
  if (error) throw new Error(`failed to add stroke: ${error.message}`);
  return data as PreviewStroke;
}

/** Deletes every stroke the given user drew (spec §4 scopes undo/clear to your own strokes). */
export async function clearOwnPreviewStrokes(strokes: PreviewStroke[], userId: string): Promise<void> {
  const ids = strokes.filter((s) => s.created_by === userId).map((s) => s.id);
  if (ids.length === 0) return;
  const { error } = await supabase.from("preview_strokes").delete().in("id", ids);
  if (error) throw new Error(`failed to clear strokes: ${error.message}`);
}

export async function deletePreviewStroke(strokeId: string): Promise<void> {
  const { error } = await supabase.from("preview_strokes").delete().eq("id", strokeId);
  if (error) throw new Error(`failed to remove stroke: ${error.message}`);
}
