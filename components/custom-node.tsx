"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  Terminal,
  Layers,
  Cpu,
  Server,
  Package,
  Database,
  Settings,
  CheckSquare,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  FileCode
} from "lucide-react";
import type { StackMapNode } from "@/lib/types";

// Map node types to Lucide Icons
const iconMap: Record<StackMapNode["type"], React.ComponentType<{ className?: string; size?: number }>> = {
  entry: Terminal,
  component: Layers,
  api: Cpu,
  service: Server,
  shared_library: Package,
  data: Database,
  config: Settings,
  test: CheckSquare,
  risk: ShieldAlert
};

// Color palettes for node types
export const nodeStyles: Record<
  StackMapNode["type"],
  {
    border: string;
    borderSel: string;
    bgSoft: string;
    text: string;
    glow: string;
    label: string;
  }
> = {
  entry: {
    border: "border-teal-200/90",
    borderSel: "border-teal-500",
    bgSoft: "bg-teal-50/90 text-teal-700",
    text: "text-teal-700",
    glow: "shadow-teal-100/50 group-hover:shadow-teal-200/50",
    label: "Entrypoint"
  },
  component: {
    border: "border-cyan-200/90",
    borderSel: "border-cyan-500",
    bgSoft: "bg-cyan-50/90 text-cyan-700",
    text: "text-cyan-700",
    glow: "shadow-cyan-100/50 group-hover:shadow-cyan-200/50",
    label: "UI Component"
  },
  api: {
    border: "border-violet-200/90",
    borderSel: "border-violet-500",
    bgSoft: "bg-violet-50/90 text-violet-700",
    text: "text-violet-700",
    glow: "shadow-violet-100/50 group-hover:shadow-violet-200/50",
    label: "API Gateway"
  },
  service: {
    border: "border-blue-200/90",
    borderSel: "border-blue-500",
    bgSoft: "bg-blue-50/90 text-blue-700",
    text: "text-blue-700",
    glow: "shadow-blue-100/50 group-hover:shadow-blue-200/50",
    label: "Service"
  },
  shared_library: {
    border: "border-indigo-200/90",
    borderSel: "border-indigo-500",
    bgSoft: "bg-indigo-50/90 text-indigo-700",
    text: "text-indigo-700",
    glow: "shadow-indigo-100/50 group-hover:shadow-indigo-200/50",
    label: "Library"
  },
  data: {
    border: "border-emerald-200/90",
    borderSel: "border-emerald-500",
    bgSoft: "bg-emerald-50/90 text-emerald-700",
    text: "text-emerald-700",
    glow: "shadow-emerald-100/50 group-hover:shadow-emerald-200/50",
    label: "Data persistence"
  },
  config: {
    border: "border-slate-200/90",
    borderSel: "border-slate-500",
    bgSoft: "bg-slate-100 text-slate-700",
    text: "text-slate-700",
    glow: "shadow-slate-150 group-hover:shadow-slate-200",
    label: "Configuration"
  },
  test: {
    border: "border-amber-200/90",
    borderSel: "border-amber-500",
    bgSoft: "bg-amber-50/90 text-amber-700",
    text: "text-amber-700",
    glow: "shadow-amber-100/50 group-hover:shadow-amber-200/50",
    label: "Verification"
  },
  risk: {
    border: "border-rose-200/90",
    borderSel: "border-rose-500",
    bgSoft: "bg-rose-50 text-rose-700",
    text: "text-rose-700",
    glow: "shadow-rose-100/50 group-hover:shadow-rose-200/50",
    label: "Security/Risk"
  }
};

export type CustomNodeData = {
  label: string;
  type: StackMapNode["type"];
  summary: string;
  files: string[];
  risks?: string[];
  isFocused: boolean;
  anyNodeSelected: boolean;
};

export function CustomArchitectureNode({
  data,
  selected
}: NodeProps & { data: CustomNodeData }) {
  const { type, label, summary, files, risks, isFocused, anyNodeSelected } = data;
  
  const style = nodeStyles[type] ?? nodeStyles.service;
  const Icon = iconMap[type] ?? Server;

  // Connection highlighting class calculations
  const isDimmed = anyNodeSelected && !isFocused;
  
  return (
    <div
      className={`group relative w-[238px] min-h-[168px] rounded-lg border-2 bg-white/80 shadow-[0_8px_32px_rgba(15,23,42,0.08)] backdrop-blur-xl transition-all duration-300 dark:bg-slate-900/70 dark:shadow-[0_8px_32px_rgba(0,0,0,0.35)] ${
        selected
          ? `${style.borderSel} shadow-lg ring-4 ring-offset-1 ${
              type === "risk" ? "ring-rose-100" : "ring-blue-100"
            } scale-105 z-20`
          : `${style.border} shadow-[0_6px_20px_rgba(15,23,42,0.05)] hover:scale-102 hover:shadow-md hover:border-slate-300`
      } ${isDimmed ? "opacity-25 scale-95 saturate-[60%] blur-[0.2px] hover:opacity-50" : "opacity-100"}`}
    >
      {/* Decorative vertical color accent */}
      <div
        className={`absolute left-0 top-0 bottom-0 w-[4px] rounded-l-md ${
          type === "entry"
            ? "bg-teal-600"
            : type === "component"
              ? "bg-cyan-600"
              : type === "api"
                ? "bg-violet-600"
                : type === "service"
                  ? "bg-blue-600"
                  : type === "shared_library"
                    ? "bg-indigo-600"
                    : type === "data"
                      ? "bg-emerald-600"
                      : type === "config"
                        ? "bg-slate-600"
                        : type === "test"
                          ? "bg-amber-600"
                          : "bg-rose-600"
        }`}
      />

      {/* Inputs handle */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className={`!h-3.5 !w-3.5 !border-2 !border-white !bg-slate-400 group-hover:scale-125 transition-transform duration-200`}
        style={{
          boxShadow: "0 0 8px rgba(148, 163, 184, 0.4)"
        }}
      />

      <div className="p-3.5 pl-4.5">
        {/* Header line */}
        <div className="flex items-center justify-between">
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${style.bgSoft}`}>
            <Icon size={10} className="stroke-[2.5]" />
            {style.label}
          </span>
          <span className="inline-flex items-center gap-0.5 rounded-full border border-slate-100/80 bg-slate-50/80 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 backdrop-blur-sm dark:border-slate-600/50 dark:bg-slate-800/60 dark:text-slate-400">
            <FileCode size={9} />
            {files.length}
          </span>
        </div>

        {/* Title */}
        <h4 className="mt-2 line-clamp-1 text-[14px] font-bold tracking-tight text-slate-900 transition-colors duration-200 group-hover:text-blue-600 dark:text-slate-50 dark:group-hover:text-blue-400">
          {label}
        </h4>

        {/* Description / Summary */}
        <p className="mt-1.5 line-clamp-2 text-[11px] leading-[15px] text-slate-500 dark:text-slate-400">
          {summary}
        </p>

        {/* Footer status indicator */}
        <div className="mt-3 flex items-center justify-between border-t border-slate-100/80 pt-2 text-[10px] dark:border-slate-700/60">
          {risks && risks.length > 0 ? (
            <span className="inline-flex items-center gap-1 font-bold text-rose-600">
              <AlertTriangle size={11} className="animate-pulse" />
              Risk Flagged
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
              <CheckCircle2 size={11} />
              Mapped
            </span>
          )}
          <span className="text-[9px] font-medium text-slate-400 uppercase tracking-widest">
            {files.length ? files[0]?.split(".").pop() : "node"}
          </span>
        </div>
      </div>

      {/* Outputs handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className={`!h-3.5 !w-3.5 !border-2 !border-white !bg-slate-400 group-hover:scale-125 transition-transform duration-200`}
        style={{
          boxShadow: "0 0 8px rgba(148, 163, 184, 0.4)"
        }}
      />
    </div>
  );
}
