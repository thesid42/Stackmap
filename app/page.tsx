"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node
} from "@xyflow/react";
import { BookOpenCheck, Bot, CheckCircle2, Clapperboard, Expand, GitBranch, Loader2, Lock, Map, Radar, Send, X } from "lucide-react";
import type { AnalysisResult, EngineerRole, OnboardingTask, StoryModeBrief } from "@/lib/types";
import { CustomArchitectureNode, nodeStyles } from "@/components/custom-node";
import { FlowFitView } from "@/components/flow-fit-view";
import { MentorMarkdown } from "@/components/mentor-markdown";
import { ThemeToggle } from "@/components/theme-toggle";
import { useThemeContext } from "@/components/theme-provider";
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

const nodeTypes = { custom: CustomArchitectureNode };

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
  const [storyBrief, setStoryBrief] = useState<StoryModeBrief | null>(null);
  const [storyClipIndex, setStoryClipIndex] = useState(0);
  const [isStoryModalOpen, setIsStoryModalOpen] = useState(false);
  const [isGeneratingStory, setIsGeneratingStory] = useState(false);
  const [storyError, setStoryError] = useState("");
  const [chatError, setChatError] = useState("");
  const [error, setError] = useState("");
  const [checkedCriteria, setCheckedCriteria] = useState<Record<string, boolean[]>>({});
  const answerRef = useRef<HTMLDivElement>(null);
  const storyAudioRef = useRef<HTMLAudioElement>(null);
  const { theme } = useThemeContext();

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

  const graphNodes = analysis?.graph?.nodes ?? [];
  const graphTasks = analysis?.tasks ?? [];
  const missionPath = useMemo(() => (graphTasks.length ? missionProgress(graphTasks) : null), [graphTasks]);
  const sortedTasks = missionPath?.sorted ?? sortMissions(graphTasks);
  const nextMission = graphTasks.length ? getNextMission(graphTasks) : undefined;

  function githubFileUrl(filePath: string) {
    if (!analysis?.graph?.repo?.url) return null;
    const base = analysis.graph.repo.url.replace(/\.git$/i, "").replace(/\/$/, "");
    return `${base}/blob/HEAD/${filePath}`;
  }

  function isTaskLocked(taskId: string) {
    const index = sortedTasks.findIndex((task) => task.id === taskId);
    return index >= 0 && isMissionLocked(sortedTasks, index);
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

  const selectedNode = graphNodes.find((node) => node.id === selectedNodeId) ?? graphNodes[0];
  const selectedTask =
    sortedTasks.find((task) => task.id === selectedTaskId) ?? nextMission ?? sortedTasks[0];
  const currentStoryScene = storyBrief?.scenes[storyClipIndex];

  const flow = useMemo(() => {
    if (!analysis?.graph?.nodes?.length) return { nodes: [] as Node[], edges: [] as Edge[] };

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

    const anyFocused = focusNodeIds.size > 0;

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
        isFocused: !anyFocused || focusNodeIds.has(node.id),
        anyNodeSelected: anyFocused
      }
    }));

    const edges: Edge[] = layoutEdges.map((edge) => {
      const isActive = !anyFocused || activeEdgeIds.has(edge.id);
      let color = "#64748b";
      if (anyFocused) {
        if (isActive) {
          if (edge.type === "depends_on") color = "#f43f5e";
          else if (edge.type === "writes" || edge.type === "reads") color = "#10b981";
          else color = "#3b82f6";
        } else {
          color = "#cbd5e1";
        }
      } else if (edge.type === "depends_on") {
        color = "#be123c";
      } else if (edge.type === "writes" || edge.type === "reads") {
        color = "#0f9f6e";
      }

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: "smoothstep",
        animated: edge.type === "publishes" || edge.type === "routes_to" || (anyFocused && isActive),
        markerEnd: { type: MarkerType.ArrowClosed, color },
        style: { stroke: color, strokeWidth: anyFocused && isActive ? 2.5 : 1.8, opacity: isActive ? 1 : 0.35 }
      };
    });

    return { nodes, edges };
  }, [analysis?.graph, selectedNodeId, selectedTask]);

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
    setStoryBrief(null);
    setStoryClipIndex(0);
    setStoryError("");
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
    setAnalysis({ ...analysis, tasks: result.tasks, familiarity: result.familiarity });

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
        setChatError(result.error ?? "Could not reach the mentor.");
        return;
      }
      setAnswer(result.answer ?? "No answer returned.");
      requestAnimationFrame(() => answerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
    } catch {
      setChatError("Network error. Try again.");
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

  async function generateStoryMode(generateVideo: boolean) {
    if (!analysis || isGeneratingStory) return;

    setIsGeneratingStory(true);
    setStoryError("");
    setStoryBrief(null);
    setStoryClipIndex(0);

    try {
      const response = await fetch("/api/story-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: analysis.jobId,
          nodeId: selectedNode?.id,
          taskId: selectedTask?.id,
          generateVideo
        })
      });
      const result = (await response.json()) as { brief?: StoryModeBrief; error?: string };

      if (!response.ok || !result.brief) {
        setStoryError(result.error ?? "Could not generate Story Mode.");
        return;
      }

      setStoryBrief(result.brief);
      setStoryClipIndex(0);
      if (result.brief.status === "failed" && result.brief.error) {
        setStoryError(result.brief.error);
      }
    } catch {
      setStoryError("Network error while generating Story Mode.");
    } finally {
      setIsGeneratingStory(false);
    }
  }

  function syncStoryAudio() {
    const audio = storyAudioRef.current;
    if (!audio) return;
    const clipOffset = (storyBrief?.scenes ?? [])
      .slice(0, storyClipIndex)
      .reduce((sum, scene) => sum + scene.durationSeconds, 0);
    audio.currentTime = Math.min(clipOffset, audio.duration || clipOffset);
  }

  async function playStoryAudio() {
    syncStoryAudio();
    await storyAudioRef.current?.play().catch(() => undefined);
  }

  function pauseStoryAudio() {
    storyAudioRef.current?.pause();
  }

  async function playStory() {
    await playStoryAudio();
  }

  function pauseStory() {
    pauseStoryAudio();
  }

  function storyVisualClass(scenePrompt?: string) {
    return `story-visual story-${scenePrompt?.replace(/[^a-z_]/gi, "").toLowerCase() || "architecture_map"}`;
  }

  function renderStoryStage(size: "compact" | "large" = "compact") {
    if (!storyBrief || !currentStoryScene) return null;
    const files = (currentStoryScene.files.length ? currentStoryScene.files : selectedNode?.files ?? []).slice(0, size === "large" ? 5 : 3);

    return (
      <div className={`story-stage ${size === "large" ? "story-stage-large" : ""}`}>
        <div className={storyVisualClass(currentStoryScene.aiVisualPrompt)}>
          <div className="story-grid" />
          <div className="story-orbit story-orbit-one" />
          <div className="story-orbit story-orbit-two" />
          <div className="story-flow story-flow-one" />
          <div className="story-flow story-flow-two" />

          <div className="story-node story-node-primary">
            <span>{currentStoryScene.overlayTitle}</span>
          </div>
          <div className="story-node story-node-secondary">
            <span>{selectedNode?.type ?? "module"}</span>
          </div>
          <div className="story-node story-node-tertiary">
            <span>{selectedTask?.area ?? "mission"}</span>
          </div>

          <div className="story-file-stack">
            {files.map((file) => (
              <div key={file} className="story-file-card">
                {file}
              </div>
            ))}
          </div>

          <div className="story-caption">
            <div className="story-kicker">Scene {storyClipIndex + 1} / {storyBrief.scenes.length}</div>
            <div className="story-title">{currentStoryScene.title}</div>
            <div className="story-narration">{currentStoryScene.narration}</div>
          </div>

          <div className="story-facts">
            {currentStoryScene.overlayFacts.slice(0, size === "large" ? 4 : 3).map((fact) => (
              <div key={fact}>{fact}</div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  function handleStoryClipEnded() {
    if (storyBrief && storyClipIndex < storyBrief.scenes.length - 1) {
      setStoryClipIndex((index) => index + 1);
      return;
    }
    storyAudioRef.current?.pause();
  }

  useEffect(() => {
    const audio = storyAudioRef.current;
    if (!audio || audio.paused) return;
    const clipOffset = (storyBrief?.scenes ?? [])
      .slice(0, storyClipIndex)
      .reduce((sum, scene) => sum + scene.durationSeconds, 0);
    audio.currentTime = Math.min(clipOffset, audio.duration || clipOffset);
  }, [storyBrief, storyClipIndex]);

  useEffect(() => {
    if (!storyBrief) return;
    const timer = window.setInterval(() => {
      const audio = storyAudioRef.current;
      if (!audio || audio.paused) return;
      const elapsed = audio.currentTime;
      let accumulated = 0;
      const nextIndex = storyBrief.scenes.findIndex((scene) => {
        accumulated += scene.durationSeconds;
        return elapsed < accumulated;
      });
      if (nextIndex >= 0 && nextIndex !== storyClipIndex) {
        setStoryClipIndex(nextIndex);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [storyBrief, storyClipIndex]);

  return (
    <main className="relative h-screen w-screen overflow-hidden bg-slate-50 font-sans text-slate-950 transition-colors duration-300 dark:bg-slate-950 dark:text-slate-100">
      <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-hidden>
        <div className="absolute -left-24 top-24 h-72 w-72 rounded-full bg-blue-400/15 blur-3xl dark:bg-blue-600/20" />
        <div className="absolute -right-16 bottom-32 h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl dark:bg-emerald-600/15" />
        <div className="absolute left-1/2 top-1/3 h-56 w-56 -translate-x-1/2 rounded-full bg-violet-400/10 blur-3xl dark:bg-violet-600/15" />
      </div>
      {/* Background Canvas Layer */}
      <div className="absolute inset-0 z-0">
        {analysis?.graph?.nodes?.length ? (
          <ReactFlowProvider>
            <ReactFlow
              nodes={flow.nodes}
              edges={flow.edges}
              nodeTypes={nodeTypes}
              fitView
              onNodeClick={(_, node) => {
                setSelectedNodeId(node.id);
              }}
              nodesDraggable
              nodesConnectable={false}
              className="stackmap-flow"
            >
              <Background color={theme === "dark" ? "#334155" : "#cbd5e1"} gap={16} size={1} />
              <MiniMap className="stackmap-minimap !right-4 !bottom-4" zoomable pannable />
              <Controls className="stackmap-controls !left-4 !bottom-24" />
              <FlowFitView nodeCount={flow.nodes.length} />
            </ReactFlow>
          </ReactFlowProvider>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-tr from-slate-50 via-slate-100 to-blue-50 p-8 text-center dark:from-slate-950 dark:via-slate-900 dark:to-blue-950">
            <div className="glass-hero hover:border-blue-200/60 dark:hover:border-blue-500/30">
              <div className="mx-auto flex h-16 w-16 animate-bounce items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-500/30">
                <Map size={32} />
              </div>
              <h2 className="mt-6 text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-50">StackMap Workspace</h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Paste any public GitHub repository to visually explore its architecture. Get source-backed evidence, onboarding missions tailored to your role, and a mentor AI ready to guide you.
              </p>
              <div className="mt-8 flex justify-center">
                <div className="inline-flex items-center gap-2 rounded-full border border-blue-200/50 bg-blue-50/80 px-4 py-1.5 text-xs font-semibold text-blue-700 backdrop-blur-md dark:border-blue-500/20 dark:bg-blue-950/50 dark:text-blue-300">
                  <Bot size={14} />
                  Powered by Gemini Managed Agents
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating UI Layer */}
      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col justify-between p-4">
        {/* Floating Header */}
        <header className="glass-header pointer-events-auto flex w-full shrink-0 items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20">
              <Map size={18} />
            </div>
            <div>
              <h1 className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-900 dark:text-slate-50">
                StackMap
                {analysis?.graph?.repo?.name && (
                  <span className="border-l border-slate-200 pl-2 text-xs font-semibold text-blue-600 dark:border-slate-600 dark:text-blue-400">
                    {analysis.graph.repo.name}
                  </span>
                )}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">Interactive architecture visualizer & role onboarding</p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-medium text-slate-600 dark:text-slate-300">
            {analysis?.graph?.repo?.url && (
              <a
                href={analysis.graph.repo.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 transition hover:text-blue-600 dark:hover:text-blue-400"
              >
                <GitBranch size={14} />
                <span>View Repo</span>
              </a>
            )}
            <div className="flex items-center gap-1.5 rounded-full border border-blue-200/40 bg-blue-50/70 px-2.5 py-1 text-[11px] font-semibold text-blue-700 backdrop-blur-md dark:border-blue-500/25 dark:bg-blue-950/50 dark:text-blue-300">
              <Bot size={13} />
              <span>AI Onboarding Mentor</span>
            </div>
            <ThemeToggle />
          </div>
        </header>

        {/* Center Grid containing Sidebars */}
        <div className="my-4 grid min-h-0 w-full flex-1 grid-cols-[minmax(0,300px)_1fr_minmax(0,320px)] gap-3 overflow-hidden">
          
          {/* Left Sidebar Overlay */}
          <aside className="pointer-events-auto flex flex-col gap-4 overflow-hidden max-h-full min-h-0">
            {/* Codebase Scanner Card */}
            <section className="glass-panel flex shrink-0 flex-col p-4">
              <div className="mb-3 flex items-center gap-2">
                <GitBranch size={16} className="animate-pulse text-blue-600 dark:text-blue-400" />
                <h2 className="text-sm font-bold text-slate-950 dark:text-slate-50">Ingest Repository</h2>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400" htmlFor="repo">
                    GitHub URL
                  </label>
                  <input
                    id="repo"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    className="glass-input mt-1"
                    placeholder="https://github.com/org/repo"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400" htmlFor="role">
                    Onboarding Role
                  </label>
                  <select
                    id="role"
                    value={role}
                    onChange={(event) => setRole(event.target.value as EngineerRole)}
                    className="glass-input mt-1"
                  >
                    {roleOptions.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  onClick={analyzeRepo}
                  disabled={isAnalyzing}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white py-2 text-xs font-bold shadow-md shadow-blue-500/20 disabled:bg-blue-300 disabled:cursor-not-allowed transition"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Analyzing Source...</span>
                    </>
                  ) : (
                    <>
                      <Radar size={14} />
                      <span>Build Architecture Map</span>
                    </>
                  )}
                </button>
                {error ? (
                  <p className="rounded-lg border border-rose-200/60 bg-rose-50/80 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 backdrop-blur-sm dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-300">
                    {error}
                  </p>
                ) : null}
                {analyzeProgress ? <p className="text-[11px] text-slate-600 dark:text-slate-400">{analyzeProgress}</p> : null}
              </div>
            </section>

            {analysis ? (
              <section className="glass-panel flex shrink-0 flex-col p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Clapperboard size={16} className="text-violet-600 dark:text-violet-400" />
                    <div>
                      <h2 className="text-sm font-bold text-slate-950 dark:text-slate-50">Story Mode</h2>
                      <p className="text-[10px] text-slate-500 dark:text-slate-400">Narrated AI walkthrough</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void generateStoryMode(true)}
                    disabled={isGeneratingStory}
                    className="inline-flex items-center gap-1 rounded-xl bg-violet-700 px-2.5 py-1.5 text-[10px] font-bold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600"
                  >
                    {isGeneratingStory ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />}
                    Generate
                  </button>
                </div>

                {storyError ? (
                  <p className="rounded-lg border border-rose-200/60 bg-rose-50/80 px-2 py-1.5 text-[10px] text-rose-700 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-300">
                    {storyError}
                  </p>
                ) : null}
                {isGeneratingStory ? (
                  <div className="glass-inset mt-2 flex items-center gap-2 px-3 py-2 text-[10px] text-slate-600 dark:text-slate-400">
                    <Loader2 size={14} className="animate-spin text-violet-600" />
                    Generating walkthrough…
                  </div>
                ) : null}

                {storyBrief ? (
                  <div className="mt-2 min-h-0">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] font-semibold text-slate-900 dark:text-slate-100">{storyBrief.title}</span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="rounded-full border border-violet-200/50 bg-violet-50/70 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-700 dark:border-violet-500/30 dark:bg-violet-950/40 dark:text-violet-300">
                          {storyBrief.scenes.length ? `${storyClipIndex + 1}/${storyBrief.scenes.length}` : storyBrief.status.replace("_", " ")}
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsStoryModalOpen(true)}
                          className="glass-icon-btn !h-7 !w-7"
                          aria-label="Open Story Mode large viewer"
                          title="Open large viewer"
                        >
                          <Expand size={12} />
                        </button>
                      </div>
                    </div>
                    {currentStoryScene ? (
                      <div>
                        {renderStoryStage("compact")}
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => void playStory()}
                            disabled={!storyBrief.audioUrl}
                            className="rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-semibold text-white disabled:opacity-50 dark:bg-slate-700"
                          >
                            Play
                          </button>
                          <button type="button" onClick={pauseStory} className="glass-mission-card px-2 py-1 text-[10px] font-semibold">
                            Pause
                          </button>
                          <button
                            type="button"
                            onClick={() => setStoryClipIndex((index) => Math.max(0, index - 1))}
                            className="glass-mission-card px-2 py-1 text-[10px] font-semibold"
                          >
                            Prev
                          </button>
                          <button
                            type="button"
                            onClick={() => setStoryClipIndex((index) => Math.min((storyBrief.scenes.length ?? 1) - 1, index + 1))}
                            className="glass-mission-card px-2 py-1 text-[10px] font-semibold"
                          >
                            Next
                          </button>
                        </div>
                        {storyBrief.audioUrl ? (
                          <audio ref={storyAudioRef} src={storyBrief.audioUrl} className="hidden" onEnded={handleStoryClipEnded} />
                        ) : null}
                        <div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-100/80 dark:bg-slate-800/80">
                          <div
                            className="h-full rounded-full bg-violet-600 transition-all"
                            style={{ width: `${((storyClipIndex + 1) / storyBrief.scenes.length) * 100}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                    {!storyBrief.audioUrl ? (
                      <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">Walkthrough ready — narration audio unavailable.</p>
                    ) : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {/* Codebase Familiarity Panel */}
            {analysis?.familiarity && (
              <section className="glass-panel flex shrink-0 flex-col p-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <h2 className="flex items-center gap-1.5 text-sm font-bold text-slate-950 dark:text-slate-50">
                    <Radar size={16} className="text-emerald-600 dark:text-emerald-400" />
                    Familiarity Score
                  </h2>
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">{analysis.familiarity.overall}%</span>
                </div>
                <div className="thin-scrollbar max-h-[140px] space-y-2 overflow-y-auto pr-1">
                  {Object.entries(analysis.familiarity.areas).map(([area, score]) => (
                    <div key={area} className="text-[11px]">
                      <div className="mb-0.5 flex justify-between font-semibold text-slate-600 dark:text-slate-400">
                        <span className="capitalize">{area.replace(/([A-Z])/g, " $1")}</span>
                        <span>{score}%</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100/80 dark:bg-slate-800/80">
                        <div 
                          className="h-full rounded-full bg-emerald-500 transition-all duration-500" 
                          style={{ width: `${score}%` }} 
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="glass-inset mt-2.5 p-2.5 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                  <span className="font-bold text-slate-800 dark:text-slate-200">Next Mission:</span> {analysis.familiarity.suggestedNextStep}
                </p>
              </section>
            )}

            {/* Week-1 onboarding path */}
            {analysis?.tasks?.length ? (
              <section className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                <div className="mb-2 flex shrink-0 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpenCheck size={16} className="text-emerald-700 dark:text-emerald-400" />
                    <h2 className="text-sm font-bold text-slate-950 dark:text-slate-50">Week-1 Path</h2>
                  </div>
                  {missionPath ? (
                    <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                      {missionPath.done}/{missionPath.total}
                    </span>
                  ) : null}
                </div>
                {missionPath && missionPath.total > 0 ? (
                  <div className="mb-2 h-1.5 shrink-0 overflow-hidden rounded-full bg-slate-100/80 dark:bg-slate-800/80">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${Math.round((missionPath.done / missionPath.total) * 100)}%` }}
                    />
                  </div>
                ) : null}
                {nextMission && nextMission.status !== "done" ? (
                  <p className="mb-2 shrink-0 rounded-lg border border-blue-200/50 bg-blue-50/60 px-2 py-1.5 text-[10px] font-medium text-blue-900 backdrop-blur-md dark:border-blue-500/25 dark:bg-blue-950/40 dark:text-blue-200">
                    Up next — Step {nextMission.order}: {nextMission.title}
                  </p>
                ) : null}

                <div className="flex-1 overflow-y-auto space-y-2 pr-1 thin-scrollbar">
                  {sortedTasks.map((task, index) => {
                    const isSelected = selectedTaskId === task.id;
                    const isDone = task.status === "done";
                    const locked = isMissionLocked(sortedTasks, index);
                    const isCurrent = nextMission?.id === task.id && !isDone;
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
                        className={`glass-mission-card ${
                          locked
                            ? "cursor-not-allowed opacity-50"
                            : isSelected
                              ? "glass-mission-card-selected"
                              : "hover:border-slate-300/60 dark:hover:border-slate-500/40"
                        } ${isCurrent ? "ring-1 ring-emerald-300/80 dark:ring-emerald-500/40" : ""}`}
                      >
                        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/50 bg-white/60 text-[10px] font-bold text-slate-600 backdrop-blur-sm dark:border-slate-600/50 dark:bg-slate-800/60 dark:text-slate-300">
                          {locked ? <Lock size={11} className="text-slate-400" /> : isDone ? "✓" : task.order ?? index + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">{task.area}</span>
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                                task.difficulty === "easy"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : task.difficulty === "medium"
                                    ? "bg-amber-50 text-amber-700"
                                    : "bg-rose-50 text-rose-700"
                              }`}
                            >
                              {task.difficulty}
                            </span>
                          </div>
                          <h3 className={`mt-1 line-clamp-1 text-xs font-bold text-slate-900 dark:text-slate-100 ${isDone ? "line-through text-slate-400 dark:text-slate-500" : ""}`}>
                            {task.title}
                          </h3>
                          <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">{task.description}</p>
                          <div className="mt-1.5 flex items-center justify-between text-[9px] font-semibold text-slate-400">
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
            ) : null}
          </aside>

          {/* Empty space in grid that lets the React Flow background show through */}
          <div className="min-h-0 pointer-events-none" />

          {/* Right Sidebar Overlay */}
          <aside className="pointer-events-auto flex flex-col gap-4 overflow-hidden max-h-full min-h-0">
            {analysis?.graph?.nodes?.length ? (
              <>
                {/* Node Inspector Panel */}
                <section className="glass-panel flex max-h-[50%] min-h-0 shrink-0 flex-col overflow-hidden p-4">
                  <div className="mb-2.5 flex shrink-0 items-center justify-between border-b border-slate-200/60 pb-2 dark:border-slate-700/60">
                    <h2 className="text-sm font-bold text-slate-950 dark:text-slate-50">Component Inspector</h2>
                    <span className="rounded-full border border-white/40 bg-white/40 px-2 py-0.5 text-[9px] font-bold uppercase text-slate-500 backdrop-blur-md dark:border-white/10 dark:bg-slate-800/50 dark:text-slate-400">
                      Node
                    </span>
                  </div>
                  
                  {selectedNode ? (
                    <div className="flex-1 overflow-y-auto space-y-3 thin-scrollbar pr-1">
                      <div>
                        <span className={`text-[9px] font-black uppercase tracking-wider ${nodeStyles[selectedNode.type].text}`}>
                          {selectedNode.type.replace("_", " ")}
                        </span>
                        <h3 className="mt-0.5 text-sm font-black text-slate-900 dark:text-slate-50">{selectedNode.label}</h3>
                        <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">{selectedNode.summary}</p>
                      </div>

                      <div>
                        <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Key Files</h4>
                        <div className="space-y-1">
                          {selectedNode.files.map((file) => {
                            const href = githubFileUrl(file);
                            return href ? (
                              <a
                                key={file}
                                href={href}
                                target="_blank"
                                rel="noreferrer"
                                className="glass-file-link text-blue-700 hover:bg-blue-50/60 dark:text-blue-400 dark:hover:bg-blue-950/40"
                              >
                                {file}
                              </a>
                            ) : (
                              <div
                                key={file}
                                className="glass-file-link text-slate-700 dark:text-slate-300"
                              >
                                {file}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {selectedNode.risks?.length ? (
                        <div>
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-rose-600 mb-1">Identified Gaps / Risks</h4>
                          <ul className="space-y-1">
                            {selectedNode.risks.map((risk) => (
                              <li key={risk} className="rounded-lg border border-rose-200/50 bg-rose-50/50 px-2.5 py-1 text-[10px] font-semibold leading-relaxed text-rose-700 backdrop-blur-sm dark:border-rose-500/30 dark:bg-rose-950/35 dark:text-rose-300">
                                ⚠️ {risk}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center p-4 text-center">
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Select a graph component to inspect details and source evidence.</p>
                    </div>
                  )}
                </section>

                {/* Mission Detail Panel */}
                <section className="glass-panel flex min-h-0 flex-1 flex-col overflow-hidden p-4">
                  <div className="mb-2.5 flex shrink-0 items-center justify-between border-b border-slate-200/60 pb-2 dark:border-slate-700/60">
                    <h2 className="text-sm font-bold text-slate-950 dark:text-slate-50">Mission Workspace</h2>
                    <span className="rounded-full border border-emerald-200/50 bg-emerald-50/70 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700 backdrop-blur-md dark:border-emerald-500/25 dark:bg-emerald-950/40 dark:text-emerald-300">
                      Mission
                    </span>
                  </div>

                  {selectedTask ? (
                    <div className="flex-1 flex flex-col justify-between overflow-hidden min-h-0">
                      <div className="flex-1 overflow-y-auto space-y-3 thin-scrollbar pr-1 pb-4">
                        {isTaskLocked(selectedTask.id) ? (
                          <p className="rounded-lg border border-amber-200/60 bg-amber-50/70 px-2.5 py-2 text-[10px] text-amber-900 backdrop-blur-sm dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-200">
                            Complete the previous step to unlock this mission.
                          </p>
                        ) : null}
                        <div>
                          <span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
                            Step {selectedTask.order ?? "?"}
                          </span>
                          <div className="mt-1 flex items-center gap-1.5">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{selectedTask.area}</span>
                            <span className="text-[9px] text-slate-300">•</span>
                            <span className="text-[9px] font-bold uppercase text-slate-500">{selectedTask.difficulty}</span>
                          </div>
                          <h3 className="mt-0.5 text-sm font-black text-slate-900 dark:text-slate-50">{selectedTask.title}</h3>
                          <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">{selectedTask.description}</p>
                        </div>

                        <div>
                          <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Files to study</h4>
                          <div className="space-y-1">
                            {selectedTask.filesToRead.map((file) => {
                              const href = githubFileUrl(file);
                              return href ? (
                                <a
                                  key={file}
                                  href={href}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="glass-file-link text-blue-700 hover:bg-blue-50/60 dark:text-blue-400 dark:hover:bg-blue-950/40"
                                >
                                  {file}
                                </a>
                              ) : (
                                <div
                                  key={file}
                                  className="glass-file-link text-slate-700 dark:text-slate-300"
                                >
                                  {file}
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div>
                          <h4 className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Success criteria</h4>
                          <ul className="space-y-1.5">
                            {selectedTask.successCriteria.map((item, criterionIndex) => {
                              const checked = criteriaChecksFor(selectedTask)[criterionIndex];
                              return (
                                <li key={item} className="flex gap-2 text-[10px] leading-relaxed text-slate-600 dark:text-slate-400">
                                  <button
                                    type="button"
                                    disabled={isTaskLocked(selectedTask.id) || selectedTask.status === "done"}
                                    onClick={() => toggleCriterion(selectedTask, criterionIndex)}
                                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold ${
                                      checked
                                        ? "border-emerald-500 bg-emerald-500 text-white"
                                        : "border-slate-300 bg-white/80 text-transparent dark:border-slate-600 dark:bg-slate-800/80"
                                    }`}
                                  >
                                    ✓
                                  </button>
                                  <span className={checked ? "text-slate-800 font-medium" : ""}>{item}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      </div>

                      <div className="shrink-0 space-y-2 border-t border-slate-200/60 pt-3 dark:border-slate-700/60">
                        <button
                          type="button"
                          onClick={() => {
                            setQuestion(`Help me with Step ${selectedTask.order}: ${selectedTask.title}`);
                            setSelectedNodeId(null);
                          }}
                          className="glass-mission-card flex w-full items-center justify-center gap-2 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200"
                        >
                          <Bot size={14} />
                          Ask mentor about this step
                        </button>
                        <button
                          type="button"
                          disabled={
                            isTaskLocked(selectedTask.id) ||
                            (selectedTask.status !== "done" && !allCriteriaChecked(selectedTask))
                          }
                          onClick={() => updateTask(selectedTask.id, selectedTask.status === "done" ? "todo" : "done")}
                          className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${
                            selectedTask.status === "done"
                              ? "bg-slate-700 hover:bg-slate-800"
                              : "bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-500/10"
                          }`}
                        >
                          <CheckCircle2 size={14} />
                          {selectedTask.status === "done"
                            ? "Re-open mission"
                            : allCriteriaChecked(selectedTask)
                              ? "Complete step & continue"
                              : "Check all criteria first"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center p-4 text-center">
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">Select a mission to view guidelines and validation criteria.</p>
                    </div>
                  )}
                </section>
              </>
            ) : (
              <div className="glass-panel flex flex-1 items-center justify-center p-6 text-center">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Awaiting codebase analysis to activate inspector workspace.</p>
              </div>
            )}
          </aside>
        </div>

        {/* Floating Bottom Panel - Mentor Chat */}
        {analysis && (
          <footer className="pointer-events-auto mx-auto w-full max-w-3xl shrink-0 z-20 flex flex-col gap-2">
            {/* Floating Chat Answer Bubble */}
            {chatError ? (
              <p className="rounded-xl border border-rose-200/60 bg-rose-50/80 px-3 py-2 text-xs text-rose-700 backdrop-blur-md dark:border-rose-500/30 dark:bg-rose-950/50 dark:text-rose-300">
                {chatError}
              </p>
            ) : null}
            {answer && !isAsking ? (
              <div ref={answerRef} className="glass-mentor-bubble thin-scrollbar">
                <div className="mb-2 flex shrink-0 items-center gap-1.5 font-black text-[9px] uppercase tracking-wider text-blue-300">
                  <Bot size={12} />
                  Mentor AI Response
                </div>
                <MentorMarkdown content={answer} />
              </div>
            ) : null}
            {isAsking ? (
              <div className="glass-chat-bar flex items-center gap-2 px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                <Loader2 size={14} className="animate-spin text-blue-600" />
                Mentor is thinking…
              </div>
            ) : null}

            {/* Floating Chat Input Bar */}
            <section className="glass-chat-bar flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-slate-900/90 text-white shadow-inner backdrop-blur-md dark:bg-slate-800/90">
                <Bot size={16} />
              </div>
              <input
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void askQuestion();
                  }
                }}
                className="flex-1 bg-transparent text-xs text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100 dark:placeholder:text-slate-500"
                placeholder={
                  selectedNode 
                    ? `Ask anything about ${selectedNode.label} or the missions...` 
                    : "Ask anything about the system..."
                }
              />
              <button
                onClick={() => void askQuestion()}
                disabled={isAsking || !question.trim()}
                className="flex h-8 shrink-0 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/90 px-4 text-xs font-bold text-white shadow-lg backdrop-blur-md transition hover:bg-slate-800 disabled:border-transparent disabled:bg-slate-200/80 disabled:text-slate-400 dark:disabled:bg-slate-800/50"
              >
                {isAsking ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Send size={13} />
                )}
                <span>Ask</span>
              </button>
            </section>
          </footer>
        )}
      </div>

      {isStoryModalOpen && storyBrief ? (
        <div className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-5 backdrop-blur-md">
          <section className="glass-panel flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-slate-200/60 px-5 py-4 dark:border-slate-700/60">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Clapperboard size={18} className="text-violet-600 dark:text-violet-400" />
                  <h2 className="truncate text-lg font-bold text-slate-950 dark:text-slate-50">{storyBrief.title}</h2>
                </div>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  Scene {storyClipIndex + 1} of {storyBrief.scenes.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsStoryModalOpen(false)}
                className="glass-icon-btn shrink-0"
                aria-label="Close Story Mode large viewer"
              >
                <X size={18} className="text-slate-600 dark:text-slate-300" />
              </button>
            </div>
            <div className="thin-scrollbar overflow-auto p-5">
              {renderStoryStage("large")}
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void playStory()}
                  disabled={!storyBrief.audioUrl}
                  className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:bg-violet-600"
                >
                  Play
                </button>
                <button type="button" onClick={pauseStory} className="glass-mission-card px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  Pause
                </button>
                <button
                  type="button"
                  onClick={() => setStoryClipIndex((index) => Math.max(0, index - 1))}
                  className="glass-mission-card px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setStoryClipIndex((index) => Math.min(storyBrief.scenes.length - 1, index + 1))}
                  className="glass-mission-card px-3 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200"
                >
                  Next
                </button>
                <div className="ml-auto min-w-[220px] flex-1">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100/80 dark:bg-slate-800/80">
                    <div
                      className="h-full rounded-full bg-violet-600 transition-all"
                      style={{ width: `${((storyClipIndex + 1) / storyBrief.scenes.length) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <style jsx global>{`
        .thin-scrollbar::-webkit-scrollbar {
          width: 5px;
          height: 5px;
        }
        .thin-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .thin-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.3);
          border-radius: 99px;
        }
        .thin-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.5);
        }
        html.dark .thin-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(100, 116, 139, 0.45);
        }
        html.dark .thin-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(148, 163, 184, 0.55);
        }
      `}</style>
    </main>
  );
}
