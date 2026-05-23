"use client";

import { useEffect } from "react";
import { useReactFlow } from "@xyflow/react";

type FlowFitViewProps = {
  nodeCount: number;
  padding?: number;
};

/** Re-fits the canvas when the graph changes (e.g. after analysis completes). */
export function FlowFitView({ nodeCount, padding = 0.14 }: FlowFitViewProps) {
  const { fitView } = useReactFlow();

  useEffect(() => {
    if (nodeCount === 0) return;
    const frame = requestAnimationFrame(() => {
      void fitView({ padding, duration: 280 });
    });
    return () => cancelAnimationFrame(frame);
  }, [nodeCount, padding, fitView]);

  return null;
}
