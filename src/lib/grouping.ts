export interface PositionedNode {
  id: string;
  x: number;
  y: number;
}

export interface Cluster {
  memberIds: string[];
  centroid: { x: number; y: number };
}

// ponytail: fixed threshold rather than card-size-aware packing. Cards are
// ~640px wide; two cards dragged adjacent (edges touching, small gap) land
// well under this. Revisit if card size ever becomes configurable.
const CLUSTER_DISTANCE = 560;

export function clusterByProximity(nodes: PositionedNode[]): Cluster[] {
  const parent = new Map<string, string>();
  nodes.forEach((n) => parent.set(n.id, n.id));

  function find(id: string): string {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  }
  function union(a: string, b: string) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].x - nodes[j].x;
      const dy = nodes[i].y - nodes[j].y;
      if (Math.sqrt(dx * dx + dy * dy) <= CLUSTER_DISTANCE) {
        union(nodes[i].id, nodes[j].id);
      }
    }
  }

  const groups = new Map<string, PositionedNode[]>();
  for (const n of nodes) {
    const root = find(n.id);
    const list = groups.get(root) ?? [];
    list.push(n);
    groups.set(root, list);
  }

  return Array.from(groups.values())
    .filter((members) => members.length > 1)
    .map((members) => ({
      memberIds: members.map((m) => m.id),
      centroid: {
        x: members.reduce((sum, m) => sum + m.x, 0) / members.length,
        y: members.reduce((sum, m) => sum + m.y, 0) / members.length,
      },
    }));
}

export function snapToGrid(value: number, gridSize = 20): number {
  return Math.round(value / gridSize) * gridSize;
}

export function reconcileGroupIds(
  clusters: Cluster[],
  existingGroupIds: Record<string, string | undefined>,
  makeId: () => string = () => crypto.randomUUID()
): Record<string, string> {
  const assignments: Record<string, string> = {};
  for (const cluster of clusters) {
    const counts = new Map<string, number>();
    for (const id of cluster.memberIds) {
      const existing = existingGroupIds[id];
      if (existing) counts.set(existing, (counts.get(existing) ?? 0) + 1);
    }
    let winner: string | null = null;
    let winnerCount = 0;
    for (const [groupId, count] of counts) {
      if (count > winnerCount) {
        winner = groupId;
        winnerCount = count;
      }
    }
    const groupId = winner ?? makeId();
    for (const id of cluster.memberIds) {
      assignments[id] = groupId;
    }
  }
  return assignments;
}
