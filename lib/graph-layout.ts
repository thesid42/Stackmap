import type { StackMapEdge, StackMapNode } from "./types";

export interface PositionedNode extends StackMapNode {
  position: { x: number; y: number };
}

/** Must match `CustomArchitectureNode` card size in components/custom-node.tsx */
export const LAYOUT_NODE_WIDTH = 238;
export const LAYOUT_NODE_HEIGHT = 168;
const COLUMN_GAP = 72;
const ROW_GAP = 56;

const X_STEP = LAYOUT_NODE_WIDTH + COLUMN_GAP;
const Y_STEP = LAYOUT_NODE_HEIGHT + ROW_GAP;

const START_X = 24;
const START_Y = 24;

const staticTiers: Record<StackMapNode["type"], number> = {
  config: 0,
  entry: 1,
  component: 2,
  api: 3,
  service: 4,
  shared_library: 4,
  data: 5,
  test: 6,
  risk: 6
};

function computeLevels(nodes: StackMapNode[], edges: StackMapEdge[]): Record<string, number> {
  const nodeLevels: Record<string, number> = {};
  nodes.forEach((node) => {
    nodeLevels[node.id] = staticTiers[node.type] ?? 3;
  });

  let changed = true;
  for (let iter = 0; iter < 12 && changed; iter++) {
    changed = false;
    for (const edge of edges) {
      const srcLvl = nodeLevels[edge.source];
      const tgtLvl = nodeLevels[edge.target];
      if (srcLvl === undefined || tgtLvl === undefined) continue;
      if (tgtLvl <= srcLvl) {
        nodeLevels[edge.target] = srcLvl + 1;
        changed = true;
      }
    }
  }

  return nodeLevels;
}

function barycenterIndex(
  nodeId: string,
  edges: StackMapEdge[],
  rowIndexById: Map<string, number>,
  direction: "in" | "out"
): number | null {
  const neighbors: number[] = [];
  for (const edge of edges) {
    if (direction === "in" && edge.target === nodeId) {
      const idx = rowIndexById.get(edge.source);
      if (idx !== undefined) neighbors.push(idx);
    }
    if (direction === "out" && edge.source === nodeId) {
      const idx = rowIndexById.get(edge.target);
      if (idx !== undefined) neighbors.push(idx);
    }
  }
  if (neighbors.length === 0) return null;
  return neighbors.reduce((sum, value) => sum + value, 0) / neighbors.length;
}

function sortLayerNodes(
  layerNodes: StackMapNode[],
  columnIndex: number,
  edges: StackMapEdge[],
  previousRowIndex: Map<string, number>
): StackMapNode[] {
  if (columnIndex === 0 || previousRowIndex.size === 0) {
    return [...layerNodes].sort((a, b) => {
      const tierDiff = (staticTiers[a.type] ?? 3) - (staticTiers[b.type] ?? 3);
      return tierDiff !== 0 ? tierDiff : a.label.localeCompare(b.label);
    });
  }

  return [...layerNodes].sort((a, b) => {
    const baryA = barycenterIndex(a.id, edges, previousRowIndex, "in");
    const baryB = barycenterIndex(b.id, edges, previousRowIndex, "in");
    if (baryA !== null && baryB !== null && baryA !== baryB) return baryA - baryB;
    if (baryA !== null && baryB === null) return -1;
    if (baryA === null && baryB !== null) return 1;
    return a.label.localeCompare(b.label);
  });
}

/**
 * Layered column layout: static architectural tiers (left → right) plus edge-aware
 * level refinement and barycenter ordering within columns to reduce crossings.
 */
export function layoutGraph(
  nodes: StackMapNode[],
  edges: StackMapEdge[]
): { nodes: PositionedNode[]; edges: StackMapEdge[] } {
  if (!nodes || nodes.length === 0) return { nodes: [], edges };

  const nodeLevels = computeLevels(nodes, edges);

  const layers: Record<number, StackMapNode[]> = {};
  nodes.forEach((node) => {
    const lvl = nodeLevels[node.id] ?? 0;
    if (!layers[lvl]) layers[lvl] = [];
    layers[lvl].push(node);
  });

  const sortedLayerIdxs = Object.keys(layers)
    .map(Number)
    .sort((a, b) => a - b);

  let maxLayerSize = 0;
  sortedLayerIdxs.forEach((lvl) => {
    maxLayerSize = Math.max(maxLayerSize, layers[lvl].length);
  });
  const maxColumnHeight = maxLayerSize * Y_STEP;

  const positionedNodes: PositionedNode[] = [];
  const rowIndexById = new Map<string, number>();

  sortedLayerIdxs.forEach((lvl, colIndex) => {
    const sortedNodes = sortLayerNodes(layers[lvl], colIndex, edges, rowIndexById);
    const columnHeight = sortedNodes.length * Y_STEP;
    const verticalOffset = (maxColumnHeight - columnHeight) / 2;

    sortedNodes.forEach((node, rowIndex) => {
      rowIndexById.set(node.id, rowIndex);
      positionedNodes.push({
        ...node,
        position: {
          x: START_X + colIndex * X_STEP,
          y: START_Y + verticalOffset + rowIndex * Y_STEP
        }
      });
    });
  });

  return { nodes: positionedNodes, edges };
}
