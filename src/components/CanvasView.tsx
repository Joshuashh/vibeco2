import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type NodeTypes,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ChatRow } from "../types/chat";
import type { ChatState } from "../lib/chatStore";
import type { MergeEvent } from "../lib/mergeEvents";
import type { AssignableTeammate } from "./AssignChatMenu";
import { ChatCard, type ChatCardNode } from "./ChatCard";
import { GroupLabel, type GroupLabelNode } from "./GroupLabel";
import { MainAgentInstrument, type MainAgentInstrumentNode } from "./MainAgentInstrument";
import { PulseEdge } from "./PulseEdge";
import { useStorage, useMutation, useSelf, useOthers } from "../lib/liveblocks";
import { computeClaimant } from "../lib/claim";
import { updateChatPosition } from "../lib/persistChat";
import { clusterByProximity, reconcileGroupIds, snapToGrid, type PositionedNode } from "../lib/grouping";
import { latestStatusByChat } from "../lib/mergeEvents";

const nodeTypes: NodeTypes = {
  chatCard: ChatCard,
  groupLabel: GroupLabel,
  mainAgentInstrument: MainAgentInstrument,
};
const edgeTypes = { pulse: PulseEdge };

// New cards spawn at a fixed grid position that's frequently outside the
// current viewport (React Flow's `fitView` only runs once, on mount) —
// without this, creating a chat looks like nothing happened. Must render as
// a child of <ReactFlow> so useReactFlow resolves to its provider.
// Exposes the live ReactFlow<->screen coordinate conversion to LiveCursors,
// which lives outside ReactFlowProvider and so can't call useReactFlow
// itself. A ref (not state) because this updates on every pan/zoom and
// LiveCursors only needs the latest value when a pointer event fires.
export type FlowScreenApi = {
  screenToFlowPosition: (pos: { x: number; y: number }) => { x: number; y: number };
  flowToScreenPosition: (pos: { x: number; y: number }) => { x: number; y: number };
  zoomTo: (level: number, options?: { duration?: number }) => void;
};

function ReportFlowApi({ apiRef }: { apiRef: RefObject<FlowScreenApi | null> }) {
  const { screenToFlowPosition, flowToScreenPosition, zoomTo } = useReactFlow();
  useEffect(() => {
    apiRef.current = { screenToFlowPosition, flowToScreenPosition, zoomTo };
    return () => {
      apiRef.current = null;
    };
  });
  return null;
}

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

// Figma-style pan gesture: dragging the empty canvas only pans while Space
// is held, so an accidental drag never moves the whole board. Ignored while
// focus is in a text field so typing a literal space doesn't trigger it.
function useSpaceHeld(): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    function isTyping(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code === "Space" && !isTyping(e.target)) setHeld(true);
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space") setHeld(false);
    }
    function onBlur() {
      setHeld(false);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return held;
}

interface CanvasViewProps {
  chats: ChatRow[];
  chatStates: Record<string, ChatState>;
  mergeEvents: MergeEvent[];
  onSend: (chatId: string, prompt: string) => void;
  onStop: (chatId: string) => void;
  onLeave: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onArchive: (chatId: string) => void;
  onExpand: (chatId: string) => void;
  onRename: (chatId: string, title: string) => void;
  onHandoff: (chatId: string, teammateEmail: string) => Promise<void>;
  assignableTeammates: AssignableTeammate[];
  flowApiRef: RefObject<FlowScreenApi | null>;
}

export function CanvasView({
  chats: allChats,
  chatStates,
  mergeEvents,
  onSend,
  onStop,
  onLeave,
  onDelete,
  onArchive,
  onExpand,
  onRename,
  onHandoff,
  assignableTeammates,
  flowApiRef,
}: CanvasViewProps) {
  // Archived chats stay in Supabase/the sidebar's Archive list but shouldn't
  // float around as an active card on the canvas.
  const chats = useMemo(() => allChats.filter((c) => !c.archived_at), [allChats]);
  const positions = useStorage((root) => root.positions);
  const chatGroups = useStorage((root) => root.chatGroups);
  const groupLabels = useStorage((root) => root.groupLabels);
  const self = useSelf();
  const others = useOthers();
  const [nodes, setNodes, onNodesChange] = useNodesState<ChatCardNode | GroupLabelNode | MainAgentInstrumentNode>(
    []
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  // Not memoizing this would create a fresh object every render; since it's a
  // dependency of the node-building effect below, that would refire the
  // effect on every render the effect itself causes — an infinite loop.
  const statusByChat = useMemo(() => latestStatusByChat(mergeEvents), [mergeEvents]);
  // `self`/`others` change identity on every presence update, including the
  // live cursor position (broadcast on every pointermove — see
  // LiveCursors.tsx). Using them directly as effect dependencies below was
  // rebuilding every canvas node, including tearing down and recreating
  // NodeResizer's internal drag state, on nearly every mouse movement — the
  // actual cause of resize/drag fighting itself mid-gesture. These derived
  // strings only change when what the effect actually cares about (email,
  // claimed chat) changes, not on cursor movement.
  const selfClaimKey = self ? `${self.presence.email}:${self.presence.claimedChatId ?? ""}` : "";
  const othersClaimKey = others.map((o) => `${o.presence.email}:${o.presence.claimedChatId ?? ""}`).join(",");
  const mergedCount = mergeEvents.filter((e) => e.status === "merged").length;
  const refreshKeyRef = useRef(0);
  const lastMergedCountRef = useRef(mergedCount);
  if (mergedCount !== lastMergedCountRef.current) {
    lastMergedCountRef.current = mergedCount;
    refreshKeyRef.current += 1;
  }

  const setPosition = useMutation(({ storage }, chatId: string, x: number, y: number) => {
    storage.get("positions").set(chatId, { x, y });
  }, []);

  const renameGroup = useMutation(({ storage }, groupId: string, label: string) => {
    storage.get("groupLabels").set(groupId, label);
  }, []);

  const recomputeGroups = useMutation(({ storage }, positioned: PositionedNode[]) => {
    const clusters = clusterByProximity(positioned);
    const existing: Record<string, string | undefined> = {};
    storage.get("chatGroups").forEach((groupId, chatId) => {
      existing[chatId] = groupId;
    });
    const assignments = reconcileGroupIds(clusters, existing);

    const groupsMap = storage.get("chatGroups");
    const labelsMap = storage.get("groupLabels");
    for (const chatId of Array.from(groupsMap.keys())) {
      if (!assignments[chatId]) groupsMap.delete(chatId);
    }
    for (const [chatId, groupId] of Object.entries(assignments)) {
      groupsMap.set(chatId, groupId);
      if (!labelsMap.get(groupId)) labelsMap.set(groupId, "Group");
    }
  }, []);

  // ponytail: re-syncs the full node list on every relevant change, keeping
  // each node's in-progress local position (`existing?.position`) so an
  // active local drag isn't fought. A remote drag of the SAME card from
  // another user can still jitter against your own drag — acceptable at this
  // team size; revisit with per-node reconciliation if it's ever felt.
  useEffect(() => {
    setNodes((current) => {
      const byId = new Map(current.map((n) => [n.id, n]));
      const chatNodes: ChatCardNode[] = chats.map((chat, index) => {
        const existing = byId.get(chat.id) as ChatCardNode | undefined;
        const stored = positions?.[chat.id];
        const fallback = { x: 100 + (index % 2) * 700, y: 260 + Math.floor(index / 2) * 720 };
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
          // No dragHandle: NodeResizer's own corner/edge controls already
          // exclude themselves from starting a node drag (via its internal
          // nodrag marking). A custom dragHandle selector doesn't know
          // about those controls, so restricting drag to the header — which
          // visually contains the top corner resize handles — made the two
          // fight over the same mousedown. The scroll region and input bar
          // are still excluded from dragging via their own `.nodrag` class.
          style: existing?.style ?? { width: 640, height: 760 },
          data: {
            chat,
            state: chatStates[chat.id] ?? { messages: [], streaming: false },
            claimant,
            isSelf: claimant === self?.presence.email,
            mergeStatus: statusByChat[chat.id] ?? null,
            onSend,
            onStop,
            onLeave,
            onDelete,
            onArchive,
            onExpand,
            onRename,
            assignableTeammates,
            onHandoff: (email: string) => onHandoff(chat.id, email),
          },
        };
      });

      const groupIdToMembers = new Map<string, ChatCardNode[]>();
      for (const node of chatNodes) {
        const groupId = chatGroups?.[node.id];
        if (!groupId) continue;
        const list = groupIdToMembers.get(groupId) ?? [];
        list.push(node);
        groupIdToMembers.set(groupId, list);
      }
      const groupNodes: GroupLabelNode[] = Array.from(groupIdToMembers.entries()).map(([groupId, members]) => {
        const centroidX = members.reduce((sum, m) => sum + m.position.x, 0) / members.length;
        const minY = Math.min(...members.map((m) => m.position.y));
        return {
          id: groupId,
          type: "groupLabel",
          position: { x: centroidX, y: minY - 40 },
          draggable: false,
          selectable: false,
          data: { label: groupLabels?.[groupId] ?? "Group", onRename: (label: string) => renameGroup(groupId, label) },
        };
      });

      const existingInstrument = byId.get("main-agent") as MainAgentInstrumentNode | undefined;
      const instrumentPosition = positions?.["main-agent"] ?? { x: 260, y: -220 };
      const instrumentNode: MainAgentInstrumentNode = {
        id: "main-agent",
        type: "mainAgentInstrument",
        position: instrumentPosition,
        // Same reasoning as chatCard above — no dragHandle, so it doesn't
        // fight with NodeResizer's own corner controls. Interactive
        // sub-regions (buttons, iframe, log) are marked `.nodrag` instead.
        style: existingInstrument?.style ?? { width: 640, height: 420 },
        data: {
          mergeEvents,
          refreshKey: refreshKeyRef.current,
          activeChatId: self?.presence.claimedChatId ?? null,
        },
      };

      return [...chatNodes, ...groupNodes, instrumentNode];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- self/others intentionally
    // replaced by selfClaimKey/othersClaimKey above; see comment there.
  }, [
    chats,
    chatStates,
    positions,
    chatGroups,
    groupLabels,
    selfClaimKey,
    othersClaimKey,
    statusByChat,
    mergeEvents,
    onSend,
    onStop,
    onLeave,
    onDelete,
    onArchive,
    onExpand,
    onRename,
    onHandoff,
    assignableTeammates,
    setNodes,
    renameGroup,
  ]);

  useEffect(() => {
    const groupIdToMembers = new Map<string, string[]>();
    for (const chat of chats) {
      const groupId = chatGroups?.[chat.id];
      if (!groupId) continue;
      const list = groupIdToMembers.get(groupId) ?? [];
      list.push(chat.id);
      groupIdToMembers.set(groupId, list);
    }
    const groupEdges = Array.from(groupIdToMembers.entries()).flatMap(([groupId, memberIds]) =>
      memberIds.map((chatId) => ({
        id: `e-${groupId}-${chatId}`,
        source: groupId,
        target: chatId,
        type: "pulse",
        data: { active: chatStates[chatId]?.streaming ?? false },
      }))
    );
    const trunkEdges = Array.from(groupIdToMembers.entries()).map(([groupId, memberIds]) => ({
      id: `e-main-agent-${groupId}`,
      source: "main-agent",
      target: groupId,
      type: "pulse",
      data: { active: memberIds.some((chatId) => chatStates[chatId]?.streaming) },
    }));
    setEdges([...trunkEdges, ...groupEdges]);
  }, [chats, chatGroups, chatStates, setEdges]);

  const handleNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (node.type === "mainAgentInstrument") {
        setPosition(node.id, node.position.x, node.position.y);
        updateChatPosition(node.id, node.position.x, node.position.y).catch(() => {
          // ponytail: main-agent has no `chats` row, so this Supabase write
          // is expected to no-op/fail silently — Liveblocks storage (above)
          // is the real persistence for its position.
        });
        return;
      }
      if (node.type !== "chatCard") return;
      const snapped = { x: snapToGrid(node.position.x), y: snapToGrid(node.position.y) };
      setPosition(node.id, snapped.x, snapped.y);
      updateChatPosition(node.id, snapped.x, snapped.y).catch((err) =>
        console.error("failed to persist chat position", err)
      );
      const allChatNodes = nodes.filter((n): n is ChatCardNode => n.type === "chatCard");
      const positioned: PositionedNode[] = allChatNodes.map((n) => ({
        id: n.id,
        x: n.id === node.id ? snapped.x : n.position.x,
        y: n.id === node.id ? snapped.y : n.position.y,
      }));
      recomputeGroups(positioned);
    },
    [nodes, setPosition, recomputeGroups]
  );

  const spaceHeld = useSpaceHeld();

  return (
    <div className="canvas-view relative min-h-0 flex-1 bg-canvas-bg">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
          panOnDrag={spaceHeld}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--canvas-dot)" gap={28} size={1.5} />
          <FocusOnNewChats chatIds={chats.map((c) => c.id)} />
          <ReportFlowApi apiRef={flowApiRef} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
