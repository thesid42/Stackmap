"use client";

import { useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  Panel,
  type Edge,
  type Node
} from "@xyflow/react";
import { BookOpenCheck, Bot, CheckCircle2, GitBranch, Loader2, Lock, Map, Radar, Send } from "lucide-react";
import type { AnalysisResult, EngineerRole, OnboardingTask } from "@/lib/types";
import { CustomArchitectureNode, nodeStyles } from "@/components/custom-node";
import { FlowFitView } from "@/components/flow-fit-view";
import { MentorMarkdown } from "@/components/mentor-markdown";
import { layoutGraph } from "@/lib/graph-layout";
import { getNextMission, isMissionLocked, missionProgress, sortMissions } from "@/lib/mission-path";

const roleOptions: { label: string; value: EngineerRole }[] = [
  { label: "Backend Intern", value: "backend" },
  { label: "Frontend Intern", value: "frontend" },
  { label: "Full-stack Engineer", value: "fullstack" },
  { label: "Infra Engineer", value: "infra" },
  { label: "QA Engineer", value: "qa" },
  { label: "OSS Contributor", value: "opensource" }
];

const nodeTypes = {
  custom: CustomArchitectureNode
};

export default function Home() {
  const [repoUrl, setRepoUrl] = useState("https://github.com/example/stackmap-demo-platform");
  const [role, setRole] = useState<EngineerRole>("backend");
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeProgress, setAnalyzeProgress] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [chatError, setChatError] = useState("");
  const [error, setError] = useState("");
  const [checkedCriteria, setCheckedCriteria] = useState<Record<string, boolean[]>>({});
  const answerRef = useRef<HTMLDivElement>(null);

  const missionPath = useMemo(() => {
    if (!analysis) return null;
    return missionProgress(analysis.tasks);
  }, [analysis]);

  const sortedTasks = missionPath?.sorted ?? [];

  function githubFileUrl(filePath: string) {
    if (!analysis?.graph.repo.url) return null;
    const base = analysis.graph.repo.url.replace(/\.git$/i, "").replace(/\/$/, "");
    return `${base}/blob/HEAD/${filePath}`;
  }

  function isTaskLocked(taskId: string) {
    const index = sortedTasks.findIndex((task) => task.id === taskId);
    if (index < 0) return false;
    return isMissionLocked(sortedTasks, index);
  }

  function criteriaChecksFor(task: OnboardingTask) {
    const existing = checkedCriteria[task.id];
    if (existing && existing.length === task.successCriteria.length) return existing;
    return task.successCriteria.map(() => false);
  }

  function allCriteriaChecked(task: OnboardingTask) {
    const checks = criteriaChecksFor(task);
    return task.successCriteria.length > 0 && checks.every(Boolean);
  }

  function toggleCriterion(task: OnboardingTask, index: number) {
    setCheckedCriteria((prev) => {
      const next = [...criteriaChecksFor(task)];
      next[index] = !next[index];
      return { ...prev, [task.id]: next };
    });
  }

  type JobPollResponse = {
    jobId: string;
    status: "processing" | "complete" | "failed";
    progress?: string;
    error?: string;
    graph?: AnalysisResult["graph"];
    tasks?: AnalysisResult["tasks"];
    familiarity?: AnalysisResult["familiarity"];
  };

  function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const selectedNode = analysis?.graph.nodes.find((node) => node.id === selectedNodeId) ?? analysis?.graph.nodes[0];
  const selectedTask =
    sortedTasks.find((task) => task.id === selectedTaskId) ?? sortedTasks[0] ?? analysis?.tasks[0];
  const nextMission = analysis ? getNextMission(analysis.tasks) : undefined;

  const flow = useMemo(() => {
    if (!analysis) return { nodes: [] as Node[], edges: [] as Edge[] };

    const { nodes: positionedNodes, edges: layoutEdges } = layoutGraph(
      analysis.graph.nodes,
      analysis.graph.edges
    );

    const focusNodeIds = new Set<string>();
    const activeEdgeIds = new Set<string>();

    if (selectedNodeId) {
      focusNodeIds.add(selectedNodeId);
      analysis.graph.edges.forEach((edge) => {
        if (edge.source === selectedNodeId) {
          focusNodeIds.add(edge.target);
          activeEdgeIds.add(edge.id);
        } else if (edge.target === selectedNodeId) {
          focusNodeIds.add(edge.source);
          activeEdgeIds.add(edge.id);
        }
      });
    } else if (selectedTask?.relatedNodeIds?.length) {
      selectedTask.relatedNodeIds.forEach((id) => focusNodeIds.add(id));
      analysis.graph.edges.forEach((edge) => {
        if (focusNodeIds.has(edge.source) && focusNodeIds.has(edge.target)) {
          activeEdgeIds.add(edge.id);
        }
      });
    }

    const anyNodeSelected = focusNodeIds.size > 0;

    const nodes: Node[] = positionedNodes.map((node) => ({
      id: node.id,
      type: "custom",
      position: node.position,
      data: {
        label: node.label,
        type: node.type,
        summary: node.summary,
        files: node.files,
        risks: node.risks,
        isFocused: !anyNodeSelected || focusNodeIds.has(node.id),
        anyNodeSelected
      }
    }));

    const edges: Edge[] = layoutEdges.map((edge) => {
      const isActive = !anyNodeSelected || activeEdgeIds.has(edge.id);
      let edgeColor = "#94a3b8";
      let edgeWidth = 1.8;
      let edgeClass = "";

      if (anyNodeSelected) {
        if (isActive) {
          edgeWidth = 2.8;
          if (edge.type === "depends_on") {
            edgeColor = "#f43f5e";
            edgeClass = "active-flow-edge active-flow-edge-rose";
          } else if (edge.type === "writes" || edge.type === "reads") {
            edgeColor = "#10b981";
            edgeClass = "active-flow-edge active-flow-edge-emerald";
          } else {
            edgeColor = "#3b82f6";
            edgeClass = "active-flow-edge active-flow-edge-blue";
          }
        } else {
          edgeColor = "#cbd5e1";
          edgeWidth = 1.2;
        }
      } else {
        if (edge.type === "depends_on") {
          edgeColor = "#be123c";
        } else if (edge.type === "writes" || edge.type === "reads") {
          edgeColor = "#0f9f6e";
        } else {
          edgeColor = "#64748b";
        }
      }

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: "smoothstep",
        animated: edge.type === "publishes" || edge.type === "routes_to" || (anyNodeSelected && isActive),
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
          width: 14,
          height: 14
        },
        style: {
          stroke: edgeColor,
          strokeWidth: edgeWidth
        },
        className: edgeClass,
        labelStyle: { fill: isActive ? "#0f172a" : "#94a3b8", fontSize: 9, fontWeight: isActive ? 700 : 500 },
        labelBgStyle: { fill: "#ffffff", fillOpacity: 0.94 },
        labelBgPadding: [6, 3],
        labelBgBorderRadius: 4
      };
    });

    return { nodes, edges };
  }, [analysis, selectedNodeId, selectedTask]);

  async function pollJob(jobId: string) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const response = await fetch(`/api/jobs/${jobId}`);
      if (!response.ok) {
        setError("Analysis job not found.");
        return;
      }

      const job = (await response.json()) as JobPollResponse;
      setAnalyzeProgress(job.progress ?? "Processing...");

      if (job.status === "failed") {
        setError(job.error ?? "Analysis failed.");
        return;
      }

      if (job.status === "complete" && job.graph && job.tasks && job.familiarity) {
        const result: AnalysisResult = {
          jobId,
          graph: job.graph,
          tasks: job.tasks,
          familiarity: job.familiarity
        };
        setAnalysis(result);
        setCheckedCriteria({});
        const firstMission = getNextMission(result.tasks) ?? sortMissions(result.tasks)[0];
        setSelectedNodeId(null);
        setSelectedTaskId(firstMission?.id ?? null);
        return;
      }

      await sleep(1500);
    }

    setError("Analysis timed out. Try a smaller public repository.");
  }

  async function analyzeRepo() {
    setIsAnalyzing(true);
    setError("");
    setAnswer("");
    setQuestion("");
    setChatError("");
    setAnalyzeProgress("Starting analysis...");

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl, role })
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? "Could not analyze repo. Check the URL and try again.");
      setIsAnalyzing(false);
      setAnalyzeProgress("");
      return;
    }

    const started = (await response.json()) as { jobId: string; status: string };
    await pollJob(started.jobId);
    setIsAnalyzing(false);
    setAnalyzeProgress("");
  }

  async function updateTask(taskId: string, status: OnboardingTask["status"]) {
    if (!analysis) return;
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId: analysis.jobId, taskId, status })
    });

    if (!response.ok) return;
    const result = (await response.json()) as Pick<AnalysisResult, "tasks" | "familiarity">;
    const updated = { ...analysis, tasks: result.tasks, familiarity: result.familiarity };
    setAnalysis(updated);

    // If the user completes the currently selected mission, advance to the next unlocked step.
    if (status === "done" && selectedTaskId === taskId) {
      const next = getNextMission(result.tasks);
      if (next && next.id !== taskId) {
        setSelectedNodeId(null);
        setSelectedTaskId(next.id);
      }
    }
  }

  async function askQuestion() {
    const trimmed = question.trim();
    if (!analysis || !trimmed || isAsking) return;

    setIsAsking(true);
    setChatError("");
    setAnswer("");
    setQuestion("");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: analysis.jobId,
          nodeId: selectedNode?.id,
          taskId: selectedTask?.id,
          question: trimmed
        })
      });

      const result = (await response.json()) as { answer?: string; error?: string };

      if (!response.ok) {
        setChatError(result.error ?? "Could not reach the mentor. Try again.");
        return;
      }

      setAnswer(result.answer ?? "No answer returned.");
      requestAnimationFrame(() => {
        answerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch {
      setChatError("Network error. Check your connection and try again.");
    } finally {
      setIsAsking(false);
    }
  }

  function handleQuestionKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void askQuestion();
    }
  }

  return (
    <main className="min-h-screen bg-[#f3f5f8] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[96%] w-full items-center justify-between px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600 text-white">
              <Map size={20} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">StackMap</h1>
              <p className="text-sm text-slate-600">Architecture maps and onboarding missions for engineering teams</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 text-sm text-slate-600 md:flex">
            <Bot size={16} />
            Gemini multi-agent orchestration
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-[96%] w-full gap-5 px-5 py-5 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-5">
          <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <GitBranch size={18} className="text-blue-600" />
              <h2 className="font-semibold">Analyze Codebase</h2>
            </div>
            <label className="text-sm font-medium text-slate-700" htmlFor="repo">
              GitHub repo URL
            </label>
            <input
              id="repo"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600"
              placeholder="https://github.com/org/repo"
            />

            <label className="mt-4 block text-sm font-medium text-slate-700" htmlFor="role">
              Onboarding role
            </label>
            <select
              id="role"
              value={role}
              onChange={(event) => setRole(event.target.value as EngineerRole)}
              className="mt-2 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600"
            >
              {roleOptions.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>

            <button
              onClick={analyzeRepo}
              disabled={isAnalyzing}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {isAnalyzing ? <Loader2 size={16} className="animate-spin" /> : <Radar size={16} />}
              {isAnalyzing ? "Running agents" : "Generate StackMap"}
            </button>
            {analyzeProgress ? <p className="mt-3 text-sm text-slate-600">{analyzeProgress}</p> : null}
            {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : null}
          </section>

          {analysis ? (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold">Codebase Familiarity</h2>
                <span className="text-2xl font-semibold text-blue-700">{analysis.familiarity.overall}%</span>
              </div>
              <div className="space-y-3">
                {Object.entries(analysis.familiarity.areas).map(([area, score]) => (
                  <div key={area}>
                    <div className="mb-1 flex justify-between text-xs font-medium capitalize text-slate-600">
                      <span>{area.replace(/([A-Z])/g, " $1")}</span>
                      <span>{score}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100">
                      <div className="h-2 rounded-full bg-emerald-600" style={{ width: `${score}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <p className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-700">{analysis.familiarity.suggestedNextStep}</p>
            </section>
          ) : null}
        </aside>

        <section className="space-y-5 flex-1 min-w-0">
          {/* Graph Section (Full Width!) */}
          <section className="h-[min(720px,75vh)] min-h-[560px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm w-full">
            {analysis ? (
              <div className="relative h-full">
                <ReactFlowProvider>
                <ReactFlow
                  nodes={flow.nodes}
                  edges={flow.edges}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.14, minZoom: 0.15, maxZoom: 1.25 }}
                  minZoom={0.08}
                  maxZoom={1.5}
                  onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                  nodesDraggable
                  nodesConnectable={false}
                  proOptions={{ hideAttribution: true }}
                  className="stackmap-flow"
                >
                  <FlowFitView nodeCount={flow.nodes.length} />
                  <Background color="#cbd5e1" gap={18} size={1.2} />
                  
                  <Panel position="top-left">
                    <div className="rounded-lg border border-slate-200 bg-white/95 p-3.5 shadow-lg backdrop-blur-md max-w-[240px]">
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                        <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        {analysis.graph.repo.name}
                      </div>
                      <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] font-bold text-slate-600">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5">{analysis.graph.nodes.length} Modules</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5">{analysis.graph.edges.length} Links</span>
                        <span className="rounded bg-slate-100 px-1.5 py-0.5">{analysis.graph.repo.framework ?? analysis.graph.repo.language}</span>
                      </div>
                    </div>
                  </Panel>

                  <Panel position="top-right">
                    <div className="hidden max-w-[260px] flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-white/90 p-2.5 shadow-lg backdrop-blur-md md:flex">
                      <div className="w-full text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Architecture Legend</div>
                      <span className="rounded bg-teal-50 border border-teal-200/60 px-1.5 py-0.5 text-[9px] font-bold text-teal-700">Entrypoint</span>
                      <span className="rounded bg-cyan-50 border border-cyan-200/60 px-1.5 py-0.5 text-[9px] font-bold text-cyan-700">UI Component</span>
                      <span className="rounded bg-violet-50 border border-violet-200/60 px-1.5 py-0.5 text-[9px] font-bold text-violet-700">API Route</span>
                      <span className="rounded bg-blue-50 border border-blue-200/60 px-1.5 py-0.5 text-[9px] font-bold text-blue-700">Service</span>
                      <span className="rounded bg-emerald-50 border border-emerald-200/60 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700">Database</span>
                      <span className="rounded bg-rose-50 border border-rose-200/60 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">Risk Item</span>
                    </div>
                  </Panel>

                  {selectedNodeId && (
                    <Panel position="bottom-center">
                      <button
                        onClick={() => setSelectedNodeId(null)}
                        className="rounded-full bg-slate-900 border border-slate-800 text-white px-3.5 py-1.5 text-xs font-semibold shadow-lg hover:bg-blue-600 transition-all duration-200 flex items-center gap-1.5 transform hover:-translate-y-0.5"
                      >
                        Clear Path Focus
                      </button>
                    </Panel>
                  )}

                  <MiniMap
                    pannable
                    zoomable
                    maskColor="rgba(15, 23, 42, 0.06)"
                    className="stackmap-minimap"
                    nodeColor={(node) => {
                      const type = (node.data as { type?: string })?.type;
                      const colors: Record<string, string> = {
                        entry: "#0d9488",
                        component: "#0891b2",
                        api: "#7c3aed",
                        service: "#2563eb",
                        shared_library: "#4f46e5",
                        data: "#059669",
                        config: "#64748b",
                        test: "#d97706",
                        risk: "#e11d48"
                      };
                      return (type && colors[type]) || "#94a3b8";
                    }}
                  />
                  <Controls className="stackmap-controls" showInteractive={false} />
                </ReactFlow>
                </ReactFlowProvider>
              </div>
            ) : (
              <div className="flex h-full items-center justify-center p-8 text-center bg-[radial-gradient(circle_at_top_left,#dbeafe,transparent_32%),linear-gradient(135deg,#ffffff,#f8fafc)]">
                <div className="max-w-md">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-blue-600 text-white shadow-lg shadow-blue-600/25">
                    <Map size={28} />
                  </div>
                  <h2 className="mt-5 text-xl font-bold tracking-tight">Generate a codebase onboarding map</h2>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    Paste a public GitHub URL to clone, index, and analyze the repo with specialist Gemini agents. Use the demo URL for an instant sample graph.
                  </p>
                </div>
              </div>
            )}
          </section>

          {/* 3-Column Dashboard under the Graph */}
          {analysis ? (
            <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr_1fr] items-start">
              {/* Column 1: Onboarding Missions */}
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <BookOpenCheck size={18} className="text-emerald-700" />
                    <h2 className="font-semibold text-slate-900">Week-1 Path</h2>
                  </div>
                  {missionPath ? (
                    <span className="text-[11px] font-bold text-slate-500">
                      {missionPath.done}/{missionPath.total} done
                    </span>
                  ) : null}
                </div>
                {missionPath && missionPath.total > 0 ? (
                  <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-600 transition-all"
                      style={{ width: `${Math.round((missionPath.done / missionPath.total) * 100)}%` }}
                    />
                  </div>
                ) : null}
                {nextMission ? (
                  <p className="mb-3 rounded-md border border-blue-100 bg-blue-50/80 px-2.5 py-2 text-[11px] font-medium text-blue-900">
                    Up next — Step {nextMission.order}: {nextMission.title}
                  </p>
                ) : null}

                <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                  {sortedTasks.map((task, index) => {
                    const isSelected = selectedTaskId === task.id;
                    const isDone = task.status === "done";
                    const locked = isMissionLocked(sortedTasks, index);
                    const isCurrent = nextMission?.id === task.id;
                    return (
                      <button
                        key={task.id}
                        type="button"
                        disabled={locked}
                        onClick={() => {
                          if (locked) return;
                          setSelectedTaskId(task.id);
                          setSelectedNodeId(null);
                        }}
                        className={`w-full text-left rounded-lg p-3.5 transition-all duration-150 border flex items-start gap-3 ${
                          locked
                            ? "cursor-not-allowed border-slate-100 bg-slate-50/80 opacity-60"
                            : isSelected
                              ? "bg-blue-50/60 border-blue-200 shadow-sm"
                              : "bg-white border-slate-100 hover:bg-slate-50/80 hover:border-slate-200"
                        } ${isCurrent && !locked ? "ring-1 ring-emerald-300/80" : ""}`}
                      >
                        <div className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-[10px] font-bold text-slate-600">
                          {locked ? <Lock size={12} className="text-slate-400" /> : isDone ? "✓" : task.order ?? index + 1}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="rounded bg-slate-100/90 text-slate-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider">
                              {task.area}
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                task.difficulty === "easy"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : task.difficulty === "medium"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {task.difficulty}
                            </span>
                            {isCurrent && !isDone ? (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-800">
                                Current
                              </span>
                            ) : null}
                          </div>

                          <h4 className="mt-2 text-[13px] font-bold text-slate-800 line-clamp-1 leading-snug">{task.title}</h4>
                          <p className="mt-1 text-[11px] leading-[15px] text-slate-500 line-clamp-2">{task.description}</p>
                          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
                            <span>⏱️ {task.estimatedMinutes} min</span>
                            <span className={isDone ? "text-emerald-600" : locked ? "text-slate-400" : "text-slate-500"}>
                              {locked ? "locked" : task.status.replace("_", " ")}
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {/* Column 2: Mission Detail */}
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-100">Mission Detail</h2>
                {selectedTask ? (
                  <div className="space-y-4">
                    {isTaskLocked(selectedTask.id) ? (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        Complete the previous mission to unlock this step.
                      </p>
                    ) : null}
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">
                          Step {selectedTask.order ?? "?"}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                            selectedTask.difficulty === "easy"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200/50"
                              : selectedTask.difficulty === "medium"
                                ? "bg-amber-50 text-amber-700 border border-amber-200/50"
                                : "bg-rose-50 text-rose-700 border border-rose-200/50"
                          }`}
                        >
                          {selectedTask.difficulty}
                        </span>
                      </div>
                      <h3 className="mt-2.5 text-[15px] font-bold text-slate-900 leading-snug">{selectedTask.title}</h3>
                      <p className="mt-2 text-xs leading-[17px] text-slate-500">{selectedTask.description}</p>
                    </div>

                    <div className="border-t border-slate-100 pt-3">
                      <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                        Success Criteria
                      </h4>
                      <ul className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                        {selectedTask.successCriteria.map((item, criterionIndex) => {
                          const checked = criteriaChecksFor(selectedTask)[criterionIndex];
                          return (
                            <li key={item} className="flex items-start gap-2.5 text-[11px] text-slate-600 leading-[15px]">
                              <button
                                type="button"
                                disabled={isTaskLocked(selectedTask.id) || selectedTask.status === "done"}
                                onClick={() => toggleCriterion(selectedTask, criterionIndex)}
                                className={`mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border text-[9px] font-bold ${
                                  checked
                                    ? "border-emerald-500 bg-emerald-500 text-white"
                                    : "border-slate-300 bg-white text-transparent"
                                }`}
                                aria-label={checked ? "Uncheck criterion" : "Check criterion"}
                              >
                                ✓
                              </button>
                              <span className={checked ? "text-slate-800" : ""}>{item}</span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>

                    {selectedTask.filesToRead && selectedTask.filesToRead.length > 0 && (
                      <div className="border-t border-slate-100 pt-3">
                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">Files to Trace</h4>
                        <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                          {selectedTask.filesToRead.map((file) => {
                            const href = githubFileUrl(file);
                            return href ? (
                              <a
                                key={file}
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-[10px] bg-slate-50 border border-slate-100/80 px-2 py-1.5 rounded text-blue-700 flex items-center gap-1.5 truncate hover:bg-blue-50"
                                title={file}
                              >
                                <span className="text-slate-400">📄</span>
                                {file}
                              </a>
                            ) : (
                              <div
                                key={file}
                                className="font-mono text-[10px] bg-slate-50 border border-slate-100/80 px-2 py-1.5 rounded text-slate-600 truncate"
                                title={file}
                              >
                                {file}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    <div className="border-t border-slate-100 pt-3 space-y-2">
                      <button
                        type="button"
                        onClick={() => {
                          setQuestion(`Help me complete this mission: ${selectedTask.title}`);
                          setSelectedNodeId(null);
                        }}
                        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Bot size={13} />
                        Ask mentor about this mission
                      </button>
                      <button
                        type="button"
                        disabled={
                          isTaskLocked(selectedTask.id) ||
                          (selectedTask.status !== "done" && !allCriteriaChecked(selectedTask))
                        }
                        onClick={() => updateTask(selectedTask.id, selectedTask.status === "done" ? "todo" : "done")}
                        className={`flex w-full items-center justify-center gap-1.5 rounded-md px-4 py-2.5 text-xs font-semibold shadow-sm transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${
                          selectedTask.status === "done"
                            ? "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                            : "bg-emerald-600 text-white hover:bg-emerald-700 shadow-emerald-100/50"
                        }`}
                      >
                        <CheckCircle2 size={13} className="stroke-[2.5]" />
                        {selectedTask.status === "done"
                          ? "Re-open Mission"
                          : allCriteriaChecked(selectedTask)
                            ? "Mark Mission Done"
                            : "Check all criteria to complete"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">Select an onboarding mission on the left to trace requirements.</p>
                )}
              </section>

              {/* Column 3: Redesigned Node Inspector */}
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="font-semibold text-slate-900 mb-4 pb-2 border-b border-slate-100">Inspector</h2>
                {selectedNode ? (
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${nodeStyles[selectedNode.type].bgSoft}`}>
                          {nodeStyles[selectedNode.type].label}
                        </span>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Node</span>
                      </div>
                      <h3 className="mt-2.5 text-[15px] font-bold text-slate-900 leading-snug">
                        {selectedNode.label}
                      </h3>
                      <p className="mt-2 text-xs leading-[17px] text-slate-500">
                        {selectedNode.summary}
                      </p>
                    </div>

                    {selectedNode.files && selectedNode.files.length > 0 && (
                      <div className="border-t border-slate-100 pt-3">
                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                          Associated Files
                        </h4>
                        <div className="space-y-1.5 max-h-[120px] overflow-y-auto pr-1">
                          {selectedNode.files.map((file) => (
                            <div
                              key={file}
                              className="font-mono text-[10px] bg-slate-50 border border-slate-100/80 px-2 py-1.5 rounded text-slate-600 flex items-center gap-1.5 truncate shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
                              title={file}
                            >
                              <span className="text-slate-400">📄</span>
                              {file}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedNode.evidence && selectedNode.evidence.length > 0 && (
                      <div className="border-t border-slate-100 pt-3">
                        <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                          Verification Evidence
                        </h4>
                        <div className="space-y-2 max-h-[140px] overflow-y-auto pr-1">
                          {selectedNode.evidence.map((item) => (
                            <div
                              key={`${item.file}-${item.reason}`}
                              className="bg-slate-50/50 border border-slate-100 p-2 rounded-md"
                            >
                              <div className="font-mono text-[9.5px] font-bold text-slate-700 truncate" title={item.file}>
                                {item.file.split("/").pop()}
                              </div>
                              <div className="mt-1 text-[10.5px] leading-normal text-slate-500">
                                {item.reason}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {selectedNode.risks && selectedNode.risks.length > 0 && (
                      <div className="border-t border-slate-100 pt-3">
                        <h4 className="text-[11px] font-bold text-rose-500 uppercase tracking-wider mb-2">
                          Flagged Risks
                        </h4>
                        <div className="space-y-1.5">
                          {selectedNode.risks.map((risk) => (
                            <div
                              key={risk}
                              className="bg-rose-50/50 border border-rose-100 rounded-lg p-2.5 flex items-start gap-2 text-[10.5px] leading-normal text-rose-700 font-medium"
                            >
                              <span className="text-rose-500 mt-0.5">⚠️</span>
                              <span>{risk}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-slate-500">Click any card on the map to inspect its real files and logic dependencies.</p>
                )}
              </section>
            </div>
          ) : null}

          {analysis ? (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Bot size={18} className="text-blue-700" />
                <h2 className="font-semibold">Mentor Chat</h2>
              </div>
              <form
                className="flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void askQuestion();
                }}
              >
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  onKeyDown={handleQuestionKeyDown}
                  disabled={isAsking}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600 disabled:bg-slate-50 disabled:text-slate-500"
                  placeholder="Ask about the selected node or mission"
                  autoComplete="off"
                />
                <button
                  type="submit"
                  disabled={isAsking || !question.trim()}
                  className="flex shrink-0 items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-400"
                >
                  {isAsking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  Ask
                </button>
              </form>
              {chatError ? <p className="mt-3 text-sm text-rose-700">{chatError}</p> : null}
              {isAsking ? (
                <div className="mt-4 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <Loader2 size={16} className="animate-spin text-blue-600" />
                  Mentor is thinking…
                </div>
              ) : null}
              {answer && !isAsking ? (
                <div ref={answerRef} className="mt-4">
                  <MentorMarkdown content={answer} />
                </div>
              ) : null}
            </section>
          ) : null}
        </section>
      </section>
    </main>
  );
}
