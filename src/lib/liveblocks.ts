import { createClient, LiveMap, type BaseUserMeta, type Json } from "@liveblocks/client";
import { createRoomContext } from "@liveblocks/react";
import { supabase } from "./supabase";

const authUrl = import.meta.env.VITE_LIVEBLOCKS_AUTH_URL;

if (!authUrl) {
  throw new Error("VITE_LIVEBLOCKS_AUTH_URL must be set (see .env.example)");
}

const client = createClient({
  authEndpoint: async (room) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? "";
    const response = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ room }),
    });
    if (!response.ok) {
      throw new Error(`liveblocks auth failed: ${response.status}`);
    }
    return await response.json();
  },
});

// Must match ROOM_ID_PATTERN in supabase/functions/liveblocks-auth/index.ts.
export function roomIdForProject(projectId: string): string {
  return `vibeco2-project-${projectId}`;
}

type Presence = {
  email: string;
  claimedChatId: string | null;
  cursor: { x: number; y: number } | null;
  // Which tab the cursor's (x, y) is relative to — canvas coords are in flow
  // space (content-relative, zoom-independent); chat/preview coords are
  // fractions of the container (0-1), so they scale to the viewer's own
  // window size instead of the sender's raw screen pixels.
  cursorView: "home" | "chat" | "canvas" | "preview" | "logbook" | "plan" | null;
  // Set the moment a user focuses a chat's input box, cleared on blur/send —
  // lets teammates see the live draft and locks them out of that same box
  // while it's "selected" (see InputBar).
  typing: { chatId: string; text: string } | null;
  // Which chat this user has marked themselves "ready to send" in, for the
  // Plan tab's Agent Window multiplayer ready-check (AgentWindow.tsx). null
  // when not ready anywhere; scoped to a chat id so readiness doesn't leak
  // across the chats a teammate switches between.
  readyForChatId: string | null;
};

type Storage = {
  positions: LiveMap<string, { x: number; y: number }>;
  chatGroups: LiveMap<string, string>;
  groupLabels: LiveMap<string, string>;
};

// Room event channel used to stream a teammate's in-progress Claude turn
// (text deltas, tool calls) live, instead of waiting for it to complete and
// land in Postgres. Typed as plain Json (not ChatEnvelope) since Liveblocks
// events must satisfy Json — callers cast at the boundary.
export const {
  RoomProvider,
  useOthers,
  useSelf,
  useUpdateMyPresence,
  useStorage,
  useMutation,
  useBroadcastEvent,
  useEventListener,
} = createRoomContext<Presence, Storage, BaseUserMeta, Json>(client);
