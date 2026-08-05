import { useCallback, useEffect, useRef } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useNodesState,
  useReactFlow,
  type NodeTypes,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";
import { ChatCard, type ChatCardNode } from "./ChatCard";
import { useStorage, useMutation, useSelf, useOthers } from "../lib/liveblocks";
import { computeClaimant } from "../lib/claim";
import { updateChatPosition } from "../lib/persistChat";

const nodeTypes: NodeTypes = { chatCard: ChatCard };

// New cards spawn at a fixed grid position that's frequently outside the
// current viewport (React Flow's `fitView` only runs once, on mount) —
// without this, creating a chat looks like nothing happened. Must render as
// a child of <ReactFlow> so useReactFlow resolves to its provider.
function FocusOnNewChats({ chatIds }: { chatIds: string[] }) {
  const { fitView } = useReactFlow();
  const seenIds = useRef<Set<string>>(new Set(chatIds));

  useEffect(() => {
    const newIds = chatIds.filter((id) => !seenIds.current.has(id));
    seenIds.current = new Set(chatIds);
    if (newIds.length === 0) return;
    fitView({ nodes: newIds.map((id) => ({ id })), duration: 300, maxZoom: 1 });
  }, [chatIds, fitView]);

  return null;
}

interface CanvasViewProps {
  chats: ChatRow[];
  chatStates: Record<string, ChatState>;
  onSend: (chatId: string, prompt: string) => void;
  onLeave: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onExpand: (chatId: string) => void;
}

export function CanvasView({ chats, chatStates, onSend, onLeave, onDelete, onExpand }: CanvasViewProps) {
  const positions = useStorage((root) => root.positions);
  const self = useSelf();
  const others = useOthers();
  const [nodes, setNodes, onNodesChange] = useNodesState<ChatCardNode>([]);

  const setPosition = useMutation(({ storage }, chatId: string, x: number, y: number) => {
    storage.get("positions").set(chatId, { x, y });
  }, []);

  // ponytail: re-syncs the full node list on every relevant change, keeping
  // each node's in-progress local position (`existing?.position`) so an
  // active local drag isn't fought. A remote drag of the SAME card from
  // another user can still jitter against your own drag — acceptable at this
  // team size; revisit with per-node reconciliation if it's ever felt.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      return chats.map((chat, index) => {
        const existing = byId.get(chat.id);
        const stored = positions?.[chat.id];
        const fallback = { x: 100 + (index % 4) * 340, y: 100 + Math.floor(index / 4) * 320 };
        const position =
          existing?.position ??
          stored ??
          (chat.position_x != null && chat.position_y != null
            ? { x: chat.position_x, y: chat.position_y }
            : fallback);
        const claimant = computeClaimant(
          chat.id,
          self ? { email: self.presence.email, claimedChatId: self.presence.claimedChatId } : null,
          others.map((o) => ({ email: o.presence.email, claimedChatId: o.presence.claimedChatId }))
        );
        return {
          id: chat.id,
          type: "chatCard",
          position,
          data: {
            chat,
            state: chatStates[chat.id] ?? { messages: [], streaming: false },
            claimant,
            isSelf: claimant === self?.presence.email,
            onSend,
            onLeave,
            onDelete,
            onExpand,
          },
        };
      });
    });
  }, [chats, chatStates, positions, self, others, onSend, onLeave, onDelete, onExpand, setNodes]);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      setPosition(node.id, node.position.x, node.position.y);
      updateChatPosition(node.id, node.position.x, node.position.y).catch((err) =>
        console.error("failed to persist chat position", err)
      );
    },
    [setPosition]
  );

  return (
    <div className="canvas-view">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={handleNodeDragStop}
          fitView
        >
          <Background />
          <FocusOnNewChats chatIds={chats.map((c) => c.id)} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
