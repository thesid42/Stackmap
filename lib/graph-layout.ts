import type { StackMapNode, StackMapEdge } from "./types";

export interface PositionedNode extends StackMapNode {
  position: { x: number; y: number };
}

/**
 * Automagically layouts nodes and edges in a horizontal, layered flow diagram.
 * It combines static architectural roles (configs on the left, databases/risks on the right)
 * with a dynamic topological sort that pushes dependent nodes further to the right.
 */
export function layoutGraph(
  nodes: StackMapNode[],
  edges: StackMapEdge[]
): { nodes: PositionedNode[]; edges: StackMapEdge[] } {
  if (!nodes || nodes.length === 0) return { nodes: [], edges };

  // 1. Static Tier mapping (request-response lifecyle, left-to-right)
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

  const nodeLevels: Record<string, number> = {};
  nodes.forEach((node) => {
    nodeLevels[node.id] = staticTiers[node.type] ?? 3;
  });

  // 2. Dynamic Topological refinement
  // If node A depends/calls node B, node B should generally be to the right of node A.
  // We run iterative relaxation passes.
  let changed = true;
  for (let iter = 0; iter < 8 && changed; iter++) {
    changed = false;
    for (const edge of edges) {
      const srcLvl = nodeLevels[edge.source];
      const tgtLvl = nodeLevels[edge.target];
      if (srcLvl !== undefined && tgtLvl !== undefined) {
        // Target should be strictly to the right of Source.
        if (tgtLvl <= srcLvl) {
          nodeLevels[edge.target] = srcLvl + 1;
          changed = true;
        }
      }
    }
  }

  // 3. Group nodes into layers
  const layers: Record<number, StackMapNode[]> = {};
  nodes.forEach((node) => {
    const lvl = nodeLevels[node.id] ?? 0;
    if (!layers[lvl]) layers[lvl] = [];
    layers[lvl].push(node);
  });

  // Get sorted layers
  const sortedLayerIdxs = Object.keys(layers)
    .map(Number)
    .sort((a, b) => a - b);

  // 4. Position parameters
  const X_GAP = 280; // horizontal separation
  const Y_GAP = 130; // vertical separation
  const START_X = 20;
  const START_Y = 20;

  // Find max layer height to center all columns vertically
  let maxLayerSize = 0;
  sortedLayerIdxs.forEach((lvl) => {
    maxLayerSize = Math.max(maxLayerSize, layers[lvl].length);
  });
  const maxColumnHeight = maxLayerSize * Y_GAP;

  const positionedNodes: PositionedNode[] = [];

  // 5. Position nodes with vertical centering per column
  sortedLayerIdxs.forEach((lvl, colIndex) => {
    const layerNodes = layers[lvl];
    const columnHeight = layerNodes.length * Y_GAP;
    // Offset to center this column vertically relative to the tallest column
    const verticalOffset = (maxColumnHeight - columnHeight) / 2;

    layerNodes.forEach((node, rowIndex) => {
      positionedNodes.push({
        ...node,
        position: {
          x: START_X + colIndex * X_GAP,
          y: START_Y + verticalOffset + rowIndex * Y_GAP
        }
      });
    });
  });

  return { nodes: positionedNodes, edges };
}
