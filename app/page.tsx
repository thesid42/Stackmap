"use client";

import { useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node
} from "@xyflow/react";
import { BookOpenCheck, Bot, CheckCircle2, GitBranch, Loader2, Map, Radar, Send } from "lucide-react";
import type { AnalysisResult, EngineerRole, OnboardingTask, StackMapNode } from "@/lib/types";

const roleOptions: { label: string; value: EngineerRole }[] = [
  { label: "Backend Intern", value: "backend" },
  { label: "Frontend Intern", value: "frontend" },
  { label: "Full-stack Engineer", value: "fullstack" },
  { label: "Infra Engineer", value: "infra" },
  { label: "QA Engineer", value: "qa" },
  { label: "OSS Contributor", value: "opensource" }
];

const nodeColors: Record<StackMapNode["type"], string> = {
  service: "#2563eb",
  entry: "#0f766e",
  api: "#7c3aed",
  component: "#0891b2",
  data: "#0f9f6e",
  config: "#475569",
  test: "#b45309",
  risk: "#be123c",
  shared_library: "#4f46e5"
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
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState("");

  const selectedNode = analysis?.graph.nodes.find((node) => node.id === selectedNodeId) ?? analysis?.graph.nodes[0];
  const selectedTask = analysis?.tasks.find((task) => task.id === selectedTaskId) ?? analysis?.tasks[0];

  const flow = useMemo(() => {
    if (!analysis) return { nodes: [] as Node[], edges: [] as Edge[] };

    const positions = [
      { x: 0, y: 120 },
      { x: 260, y: 40 },
      { x: 520, y: 40 },
      { x: 260, y: 230 },
      { x: 520, y: 230 },
      { x: 780, y: 230 },
      { x: 520, y: 410 }
    ];

    const nodes: Node[] = analysis.graph.nodes.map((node, index) => ({
      id: node.id,
      position: positions[index] ?? { x: (index % 3) * 280, y: Math.floor(index / 3) * 180 },
      data: {
        label: (
          <div className="min-w-[150px]">
            <div className="text-[11px] font-semibold uppercase text-slate-500">{node.type.replace("_", " ")}</div>
            <div className="mt-1 text-sm font-semibold text-slate-950">{node.label}</div>
            {node.risks?.length ? <div className="mt-2 text-xs font-medium text-rose-700">Risk flagged</div> : null}
          </div>
        )
      },
      style: {
        border: `2px solid ${nodeColors[node.type]}`,
        borderRadius: 8,
        background: "#ffffff",
        boxShadow: "0 8px 18px rgba(15, 23, 42, 0.08)",
        padding: 10
      }
    }));

    const edges: Edge[] = analysis.graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      animated: edge.type === "publishes" || edge.type === "routes_to",
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: edge.type === "depends_on" ? "#be123c" : "#64748b", strokeWidth: 2 }
    }));

    return { nodes, edges };
  }, [analysis]);

  async function analyzeRepo() {
    setIsAnalyzing(true);
    setError("");
    setAnswer("");

    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoUrl, role })
    });

    if (!response.ok) {
      setError("Could not analyze repo. Check the URL and try again.");
      setIsAnalyzing(false);
      return;
    }

    const result = (await response.json()) as AnalysisResult;
    setAnalysis(result);
    setSelectedNodeId(result.graph.nodes[0]?.id ?? null);
    setSelectedTaskId(result.tasks[0]?.id ?? null);
    setIsAnalyzing(false);
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
  }

  async function askQuestion() {
    if (!analysis || !question.trim()) return;
    setIsAsking(true);
    setAnswer("");

    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobId: analysis.jobId,
        nodeId: selectedNode?.id,
        taskId: selectedTask?.id,
        question
      })
    });

    const result = (await response.json()) as { answer?: string };
    setAnswer(result.answer ?? "No answer returned.");
    setIsAsking(false);
  }

  return (
    <main className="min-h-screen bg-[#f3f5f8] text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
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
            Gemini managed-agent skeleton
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-5 px-5 py-5 lg:grid-cols-[360px_1fr]">
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

        <section className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
            <section className="h-[520px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
              {analysis ? (
                <ReactFlow
                  nodes={flow.nodes}
                  edges={flow.edges}
                  fitView
                  onNodeClick={(_, node) => setSelectedNodeId(node.id)}
                  nodesDraggable
                >
                  <Background />
                  <MiniMap pannable zoomable />
                  <Controls />
                </ReactFlow>
              ) : (
                <div className="flex h-full items-center justify-center p-8 text-center">
                  <div>
                    <Map size={42} className="mx-auto text-slate-400" />
                    <h2 className="mt-4 text-xl font-semibold">Generate a codebase onboarding map</h2>
                    <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600">
                      The base skeleton uses sample data now. Replace the analyzer with GitHub ingestion and Gemini agents during the hackathon.
                    </p>
                  </div>
                </div>
              )}
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="font-semibold">Inspector</h2>
              {selectedNode ? (
                <div className="mt-4 space-y-4">
                  <div>
                    <div className="text-xs font-semibold uppercase text-slate-500">{selectedNode.type.replace("_", " ")}</div>
                    <h3 className="mt-1 text-lg font-semibold">{selectedNode.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-700">{selectedNode.summary}</p>
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">Files</h4>
                    <ul className="mt-2 space-y-1 text-sm text-slate-700">
                      {selectedNode.files.map((file) => (
                        <li key={file} className="rounded-md bg-slate-50 px-2 py-1">
                          {file}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {selectedNode.risks?.length ? (
                    <div>
                      <h4 className="text-sm font-semibold text-rose-700">Risks</h4>
                      <ul className="mt-2 space-y-1 text-sm text-rose-700">
                        {selectedNode.risks.map((risk) => (
                          <li key={risk}>{risk}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-600">Select a graph node to inspect source evidence.</p>
              )}
            </section>
          </div>

          {analysis ? (
            <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <BookOpenCheck size={18} className="text-emerald-700" />
                  <h2 className="font-semibold">Onboarding Missions</h2>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {analysis.tasks.map((task) => (
                    <button
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`rounded-lg border p-4 text-left transition ${
                        selectedTaskId === task.id ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase text-slate-500">{task.area}</span>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{task.difficulty}</span>
                      </div>
                      <h3 className="mt-2 font-semibold">{task.title}</h3>
                      <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-600">{task.description}</p>
                      <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                        <span>{task.estimatedMinutes} min</span>
                        <span className="capitalize">{task.status.replace("_", " ")}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <h2 className="font-semibold">Mission Detail</h2>
                {selectedTask ? (
                  <div className="mt-4 space-y-4">
                    <div>
                      <h3 className="font-semibold">{selectedTask.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-700">{selectedTask.description}</p>
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold">Success Criteria</h4>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                        {selectedTask.successCriteria.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <button
                      onClick={() => updateTask(selectedTask.id, selectedTask.status === "done" ? "todo" : "done")}
                      className="flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white"
                    >
                      <CheckCircle2 size={16} />
                      {selectedTask.status === "done" ? "Mark Todo" : "Mark Done"}
                    </button>
                  </div>
                ) : null}
              </section>
            </div>
          ) : null}

          {analysis ? (
            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <Bot size={18} className="text-blue-700" />
                <h2 className="font-semibold">Mentor Chat</h2>
              </div>
              <div className="flex gap-2">
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-600"
                  placeholder="Ask about the selected node or mission"
                />
                <button
                  onClick={askQuestion}
                  disabled={isAsking}
                  className="flex items-center gap-2 rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:bg-slate-400"
                >
                  {isAsking ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                  Ask
                </button>
              </div>
              {answer ? <p className="mt-4 rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-700">{answer}</p> : null}
            </section>
          ) : null}
        </section>
      </section>
    </main>
  );
}
