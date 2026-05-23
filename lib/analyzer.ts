import { randomUUID } from "node:crypto";
import { stackMapAgentPlan, buildGraphPrompt } from "@/lib/agent-orchestrator";
import { calculateFamiliarity } from "@/lib/analysis-store";
import { getGeminiClient } from "@/lib/gemini";
import { cloneRepository, scanRepository, type RepoScan } from "@/lib/repo-scanner";
import type { AnalysisResult, EngineerRole, OnboardingTask, StackMapEdge, StackMapGraph, StackMapNode } from "@/lib/types";

type GeneratedAnalysis = {
  graph: StackMapGraph;
  tasks: OnboardingTask[];
};

export async function analyzeRepository(repoUrl: string, role: EngineerRole): Promise<AnalysisResult> {
  const cloned = await cloneRepository(repoUrl);

  try {
    const scan = await scanRepository(cloned.repo, cloned.rootPath);
    const generated = await generateWithGemini(scan, role);
    const normalized = normalizeGeneratedAnalysis(generated ?? buildFallbackAnalysis(scan, role), scan);
    const tasks = normalized.tasks.length ? normalized.tasks : buildFallbackTasks(scan, role, normalized.graph.nodes);

    return {
      jobId: randomUUID(),
      graph: normalized.graph,
      tasks,
      familiarity: calculateFamiliarity(tasks)
    };
  } finally {
    await cloned.cleanup();
  }
}

async function generateWithGemini(scan: RepoScan, role: EngineerRole): Promise<GeneratedAnalysis | null> {
  const client = getGeminiClient();
  if (!client) return null;

  const prompt = [
    buildGraphPrompt({
      repoUrl: scan.repo.displayUrl,
      role,
      fileTree: scan.fileTree,
      snippets: scan.snippets
    }),
    `Agent plan:\n${stackMapAgentPlan.map((agent) => `- ${agent.name}: ${agent.goal}`).join("\n")}`,
    "Return exactly this JSON shape:",
    JSON.stringify(
      {
        graph: {
          repo: {
            name: scan.repo.name,
            url: scan.repo.displayUrl,
            sourceType: scan.sourceType,
            language: scan.language,
            framework: scan.framework
          },
          nodes: [
            {
              id: "stable-node-id",
              label: "Human readable name",
              type: "entry | api | component | service | data | config | test | risk | shared_library",
              summary: "Short source-backed summary",
              files: ["path/from/repo.ts"],
              evidence: [{ file: "path/from/repo.ts", lines: [1, 20], reason: "Why this file proves the claim" }],
              risks: ["Optional risk"],
              suggestedQuestions: ["Optional question"]
            }
          ],
          edges: [{ id: "source-target", source: "source-node-id", target: "target-node-id", label: "relationship", type: "imports" }]
        },
        tasks: [
          {
            id: "stable-task-id",
            title: "Mission title",
            difficulty: "easy | medium | hard",
            area: "architecture | frontend | backend | api | data | testing | infra | risk",
            description: "What the engineer should do",
            filesToRead: ["path/from/repo.ts"],
            successCriteria: ["Observable completion criteria"],
            estimatedMinutes: 20,
            relatedNodeIds: ["stable-node-id"],
            status: "todo"
          }
        ]
      },
      null,
      2
    )
  ].join("\n\n");

  try {
    const result = await client.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
      contents: prompt
    });
    return parseGeminiJson(result.text ?? "");
  } catch (error) {
    console.error("Gemini analysis failed. Falling back to local scan.", error);
    return null;
  }
}

function parseGeminiJson(raw: string): GeneratedAnalysis | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1) return null;

  const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as Partial<GeneratedAnalysis>;
  if (!parsed.graph || !Array.isArray(parsed.graph.nodes) || !Array.isArray(parsed.graph.edges)) return null;
  if (!Array.isArray(parsed.tasks)) parsed.tasks = [];
  return parsed as GeneratedAnalysis;
}

function normalizeGeneratedAnalysis(generated: GeneratedAnalysis, scan: RepoScan): GeneratedAnalysis {
  const nodes = generated.graph.nodes
    .filter((node) => node.id && node.label && node.type)
    .map((node) => ({
      ...node,
      files: cleanFileList(node.files),
      evidence: Array.isArray(node.evidence) ? node.evidence.filter((item) => item.file && item.reason) : []
    }));
  const nodeIds = new Set(nodes.map((node) => node.id));

  return {
    graph: {
      repo: {
        name: scan.repo.name,
        url: scan.repo.displayUrl,
        sourceType: scan.sourceType,
        language: scan.language,
        framework: scan.framework ?? generated.graph.repo.framework
      },
      nodes,
      edges: generated.graph.edges
        .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
        .map((edge, index) => ({
          ...edge,
          id: edge.id || `${edge.source}-${edge.target}-${index}`,
          label: edge.label || edge.type || "depends on",
          type: edge.type || "depends_on"
        }))
    },
    tasks: generated.tasks
      .filter((task) => task.id && task.title)
      .map((task) => ({
        ...task,
        filesToRead: cleanFileList(task.filesToRead),
        successCriteria: Array.isArray(task.successCriteria) && task.successCriteria.length ? task.successCriteria : ["Explain what you learned"],
        relatedNodeIds: Array.isArray(task.relatedNodeIds) ? task.relatedNodeIds.filter((id) => nodeIds.has(id)) : [],
        status: task.status ?? "todo"
      }))
  };
}

function buildFallbackAnalysis(scan: RepoScan, role: EngineerRole): GeneratedAnalysis {
  const nodes = buildFallbackNodes(scan);
  return {
    graph: {
      repo: {
        name: scan.repo.name,
        url: scan.repo.displayUrl,
        sourceType: scan.sourceType,
        language: scan.language,
        framework: scan.framework
      },
      nodes,
      edges: buildFallbackEdges(nodes)
    },
    tasks: buildFallbackTasks(scan, role, nodes)
  };
}

function buildFallbackNodes(scan: RepoScan): StackMapNode[] {
  const groups = [
    {
      id: "entrypoints",
      label: "Entrypoints",
      type: "entry",
      files: scan.files.filter((file) => file.kind === "entry"),
      summary: "Files that appear to start pages, apps, servers, or public execution paths."
    },
    {
      id: "api-surface",
      label: "API Surface",
      type: "api",
      files: scan.files.filter((file) => file.kind === "route"),
      summary: "Routes, controllers, handlers, or endpoint-like files found in the repo."
    },
    {
      id: "ui-components",
      label: "UI Components",
      type: "component",
      files: scan.files.filter((file) => file.kind === "component"),
      summary: "Client-facing React or component files that shape the user interface."
    },
    {
      id: "services",
      label: "Services and Workers",
      type: "service",
      files: scan.files.filter((file) => file.kind === "service"),
      summary: "Service, worker, and business-logic files that likely own behavior."
    },
    {
      id: "data-layer",
      label: "Data Layer",
      type: "data",
      files: scan.files.filter((file) => file.kind === "model"),
      summary: "Model, schema, ORM, and persistence files found during indexing."
    },
    {
      id: "configuration",
      label: "Configuration",
      type: "config",
      files: scan.files.filter((file) => file.kind === "config"),
      summary: "Configuration files that define tooling, environment, deployment, or framework setup."
    },
    {
      id: "tests",
      label: "Tests",
      type: "test",
      files: scan.files.filter((file) => file.kind === "test"),
      summary: "Test files and test folders discovered in the repository."
    }
  ] satisfies { id: string; label: string; type: StackMapNode["type"]; files: typeof scan.files; summary: string }[];

  const nodes = groups
    .filter((group) => group.files.length > 0)
    .map((group) => toNode(group.id, group.label, group.type, group.summary, group.files.map((file) => file.path)));

  if (!groups.find((group) => group.id === "tests")?.files.length) {
    nodes.push({
      id: "risk-testing-gap",
      label: "Testing Gap",
      type: "risk",
      summary: "No obvious test files were found in the indexed source set.",
      files: [],
      evidence: [{ file: "repo index", reason: "The scanner did not classify any indexed files as tests." }],
      risks: ["Add or identify tests before large onboarding changes."],
      suggestedQuestions: ["Where should a new engineer add their first test?"]
    });
  }

  return nodes.length
    ? nodes
    : [
        {
          id: "repo-files",
          label: "Repository Files",
          type: "entry",
          summary: "StackMap indexed files but could not confidently classify them yet.",
          files: scan.files.slice(0, 8).map((file) => file.path),
          evidence: [{ file: "repo index", reason: "Fallback node created from scanned repository files." }],
          suggestedQuestions: ["What are the most important files to read first?"]
        }
      ];
}

function toNode(id: string, label: string, type: StackMapNode["type"], summary: string, files: string[]): StackMapNode {
  const visibleFiles = files.slice(0, 8);
  return {
    id,
    label,
    type,
    summary,
    files: visibleFiles,
    evidence: visibleFiles.slice(0, 4).map((file) => ({
      file,
      reason: `Classified as ${type} by StackMap's repository scanner.`
    })),
    suggestedQuestions: [`Which files in ${label} should I read first?`, `What should I change carefully in ${label}?`]
  };
}

function buildFallbackEdges(nodes: StackMapNode[]): StackMapEdge[] {
  const has = (id: string) => nodes.some((node) => node.id === id);
  const candidates: StackMapEdge[] = [
    { id: "entrypoints-ui", source: "entrypoints", target: "ui-components", label: "renders", type: "depends_on" },
    { id: "entrypoints-api", source: "entrypoints", target: "api-surface", label: "routes to", type: "routes_to" },
    { id: "api-services", source: "api-surface", target: "services", label: "calls", type: "calls" },
    { id: "services-data", source: "services", target: "data-layer", label: "reads/writes", type: "writes" },
    { id: "tests-api", source: "tests", target: "api-surface", label: "covers", type: "depends_on" },
    { id: "risk-tests", source: "risk-testing-gap", target: "entrypoints", label: "missing coverage", type: "depends_on" },
    { id: "config-entrypoints", source: "configuration", target: "entrypoints", label: "configures", type: "depends_on" }
  ];

  return candidates.filter((edge) => has(edge.source) && has(edge.target));
}

function buildFallbackTasks(scan: RepoScan, role: EngineerRole, nodes: StackMapNode[]): OnboardingTask[] {
  const primaryFiles = scan.files.slice(0, 8).map((file) => file.path);
  const firstNodeIds = nodes.slice(0, 4).map((node) => node.id);
  const roleArea = role === "frontend" ? "frontend" : role === "infra" ? "infra" : role === "qa" ? "testing" : "backend";

  return [
    {
      id: "task-map-repo",
      title: "Read the scanned repo map",
      difficulty: "easy",
      area: "architecture",
      description: `Identify the main folders, framework signals, and first files in ${scan.repo.name}.`,
      filesToRead: primaryFiles.slice(0, 4),
      successCriteria: ["Name the likely entrypoints", "Identify the highest-impact folder", "Explain one dependency or data flow"],
      estimatedMinutes: 15,
      relatedNodeIds: firstNodeIds,
      status: "todo"
    },
    {
      id: "task-trace-flow",
      title: "Trace one user-facing flow",
      difficulty: "medium",
      area: roleArea,
      description: "Pick an entrypoint or route from the graph and trace which files it depends on.",
      filesToRead: primaryFiles.slice(0, 6),
      successCriteria: ["Start from one entry file", "List the next two files it touches", "Write down one edge case"],
      estimatedMinutes: 30,
      relatedNodeIds: firstNodeIds,
      status: "todo"
    },
    {
      id: "task-risk-check",
      title: "Find a safe first improvement",
      difficulty: "medium",
      area: scan.files.some((file) => file.kind === "test") ? "testing" : "risk",
      description: "Use the graph evidence to find a small test, validation, copy, or logging improvement.",
      filesToRead: primaryFiles,
      successCriteria: ["Choose a small scoped change", "Explain why it is low risk", "Name the manual check or test to run"],
      estimatedMinutes: 35,
      relatedNodeIds: firstNodeIds,
      status: "todo"
    }
  ];
}

function cleanFileList(files: string[] | undefined) {
  if (!Array.isArray(files)) return [];
  return [...new Set(files.filter((file) => typeof file === "string" && file.trim()).map((file) => file.trim()))].slice(0, 10);
}
