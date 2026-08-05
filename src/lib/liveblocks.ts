import { createClient } from "@liveblocks/client";
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

export const ROOM_ID = "vibeco2-global";

type Presence = {
  email: string;
};

export const { RoomProvider, useOthers, useSelf } = createRoomContext<Presence>(client);
