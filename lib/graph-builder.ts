import type { AgentPartialOutput } from "@/lib/agent-orchestrator";
import { extractImportHints, type ImportHint, type RepoIndex, type RepoService } from "@/lib/repo-indexer";
import { assignMissionOrder } from "@/lib/mission-path";
import type { EngineerRole, OnboardingTask, StackMapEdge, StackMapGraph, StackMapNode } from "@/lib/types";

export type GraphBuildInput = {
  repo: StackMapGraph["repo"];
  index: RepoIndex;
  agentOutputs: AgentPartialOutput[];
  role: EngineerRole;
  snippets: { path: string; content: string }[];
};

export function mergeAgentOutputs(input: GraphBuildInput): { graph: StackMapGraph; tasks: OnboardingTask[] } {
  const mergedNodes = new Map<string, StackMapNode>();
  const mergedEdges = new Map<string, StackMapEdge>();
  const mergedTasks: OnboardingTask[] = [];

  for (const output of input.agentOutputs) {
    for (const node of output.nodes ?? []) {
      if (!node.id) continue;
      const existing = mergedNodes.get(node.id);
      mergedNodes.set(node.id, existing ? mergeNode(existing, node) : normalizeNode(node));
    }
    for (const edge of output.edges ?? []) {
      if (!edge.source || !edge.target) continue;
      const id = edge.id || `${edge.source}-${edge.target}-${edge.type ?? "depends_on"}`;
      mergedEdges.set(id, {
        id,
        source: edge.source,
        target: edge.target,
        label: edge.label || edge.type || "depends on",
        type: edge.type || "depends_on"
      });
    }
    if (output.tasks?.length) mergedTasks.push(...output.tasks);
  }

  if (mergedNodes.size === 0) {
    for (const node of buildIndexNodes(input.index, input.repo)) {
      mergedNodes.set(node.id, node);
    }
  }

  const nodes = [...mergedNodes.values()];
  const nodeIds = new Set(nodes.map((node) => node.id));

  for (const edge of buildIndexEdges(input.index, nodes)) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    mergedEdges.set(edge.id, edge);
  }

  for (const edge of buildImportEdges(input.index.importHints, nodes)) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    mergedEdges.set(edge.id, edge);
  }

  const graph: StackMapGraph = {
    repo: input.repo,
    nodes: nodes.map((node) => ensureEvidence(node)),
    edges: [...mergedEdges.values()].filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
  };

  const tasks = dedupeTasks(
    mergedTasks.length ? mergedTasks : buildDefaultTasks(input.role, graph.nodes),
    nodeIds
  );

  return { graph, tasks };
}

export function normalizeGraph(graph: StackMapGraph, tasks: OnboardingTask[]): { graph: StackMapGraph; tasks: OnboardingTask[] } {
  const nodes = graph.nodes
    .filter((node) => node.id && node.label && node.type)
    .map((node) => ensureEvidence(normalizeNode(node)));

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges
    .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
    .map((edge, index) => ({
      id: edge.id || `${edge.source}-${edge.target}-${index}`,
      source: edge.source,
      target: edge.target,
      label: edge.label || edge.type || "depends on",
      type: edge.type || "depends_on"
    }));

  return {
    graph: { repo: graph.repo, nodes, edges },
    tasks: dedupeTasks(tasks, nodeIds)
  };
}

function mergeNode(existing: StackMapNode, incoming: Partial<StackMapNode>): StackMapNode {
  return normalizeNode({
    ...existing,
    ...incoming,
    files: [...new Set([...(existing.files ?? []), ...(incoming.files ?? [])])].slice(0, 12),
    evidence: [...(existing.evidence ?? []), ...(incoming.evidence ?? [])].slice(0, 8),
    risks: [...new Set([...(existing.risks ?? []), ...(incoming.risks ?? [])])],
    suggestedQuestions: [...new Set([...(existing.suggestedQuestions ?? []), ...(incoming.suggestedQuestions ?? [])])]
  });
}

function normalizeNode(node: Partial<StackMapNode>): StackMapNode {
  return {
    id: node.id ?? "unknown",
    label: node.label ?? "Unknown",
    type: node.type ?? "service",
    summary: node.summary ?? "No summary provided.",
    files: cleanFiles(node.files),
    evidence: Array.isArray(node.evidence) ? node.evidence.filter((item) => item.file && item.reason) : [],
    risks: node.risks,
    suggestedQuestions: node.suggestedQuestions
  };
}

function ensureEvidence(node: StackMapNode): StackMapNode {
  if (node.evidence.length > 0) return node;
  if (node.files.length === 0) {
    return {
      ...node,
      evidence: [{ file: "repo index", reason: `Inferred ${node.type} node "${node.label}" from repository structure.` }]
    };
  }
  return {
    ...node,
    evidence: node.files.slice(0, 4).map((file) => ({
      file,
      reason: `Listed in ${node.label} during architecture indexing.`
    }))
  };
}

function buildIndexNodes(index: RepoIndex, repo: StackMapGraph["repo"]): StackMapNode[] {
  if (index.sourceType === "monorepo" && index.services.length > 1) {
    return index.services.map((service) => serviceToNode(service, repo.framework));
  }
  return buildLayerNodes(index);
}

function serviceToNode(service: RepoService, framework?: string): StackMapNode {
  const entryFiles = service.files.filter((file) => file.kind === "entry" || file.kind === "route");
  const dataFiles = service.files.filter((file) => file.kind === "model");
  const type = entryFiles.length
    ? "service"
    : dataFiles.length
      ? "data"
      : service.rootPath.startsWith("packages/")
        ? "shared_library"
        : "service";

  return {
    id: service.id,
    label: service.name,
    type,
    summary: `${service.name} under ${service.rootPath} with ${service.files.length} indexed files${framework ? ` (${framework})` : ""}.`,
    files: service.files.slice(0, 8).map((file) => file.path),
    evidence: service.files.slice(0, 3).map((file) => ({
      file: file.path,
      reason: `Indexed as ${file.kind} inside ${service.rootPath}.`
    })),
    suggestedQuestions: [`What does ${service.name} own?`, `Which APIs or modules does ${service.name} expose?`]
  };
}

function buildLayerNodes(index: RepoIndex): StackMapNode[] {
  const groups: { id: string; label: string; type: StackMapNode["type"]; kinds: IndexedFileKind[]; summary: string }[] = [
    { id: "entrypoints", label: "Entrypoints", type: "entry", kinds: ["entry"], summary: "App, page, and server entry files." },
    { id: "api-surface", label: "API Surface", type: "api", kinds: ["route"], summary: "Routes, controllers, and handlers." },
    { id: "ui-components", label: "UI Components", type: "component", kinds: ["component"], summary: "UI and component files." },
    { id: "services", label: "Services", type: "service", kinds: ["service"], summary: "Service and worker modules." },
    { id: "data-layer", label: "Data Layer", type: "data", kinds: ["model"], summary: "Models, schemas, and persistence." },
    { id: "configuration", label: "Configuration", type: "config", kinds: ["config"], summary: "Config and deployment files." },
    { id: "tests", label: "Tests", type: "test", kinds: ["test"], summary: "Test files discovered in the repo." }
  ];

  type IndexedFileKind = (typeof index.importantFiles)[number]["kind"];

  const allFiles = index.services[0]?.files ?? index.importantFiles;
  const nodes: StackMapNode[] = [];
  for (const group of groups) {
    const files = allFiles.filter((file) => group.kinds.includes(file.kind));
    if (!files.length) continue;
    nodes.push({
      id: group.id,
      label: group.label,
      type: group.type,
      summary: group.summary,
      files: files.map((file) => file.path).slice(0, 8),
      evidence: files.slice(0, 3).map((file) => ({
        file: file.path,
        reason: `Classified as ${file.kind} by StackMap indexer.`
      })),
      suggestedQuestions: [`What should I read first in ${group.label}?`]
    });
  }

  if (!nodes.some((node) => node.id === "tests")) {
    nodes.push({
      id: "risk-testing-gap",
      label: "Testing Gap",
      type: "risk",
      summary: "No obvious test files were found in the indexed set.",
      files: [],
      evidence: [{ file: "repo index", reason: "Indexer did not classify test files." }],
      risks: ["Add or locate tests before large onboarding changes."]
    });
  }

  return nodes;
}

function buildIndexEdges(index: RepoIndex, nodes: StackMapNode[]): StackMapEdge[] {
  const has = (id: string) => nodes.some((node) => node.id === id);
  const edges: StackMapEdge[] = [];

  if (index.sourceType === "monorepo" && index.services.length > 1) {
    const serviceIds = index.services.map((service) => service.id);
    const web = serviceIds.find((id) => id.includes("web") || id.includes("app"));
    const api = serviceIds.find((id) => id.includes("api") || id.includes("auth"));
    const data = serviceIds.find((id) => id.includes("db") || id.includes("data") || id.includes("prisma"));
    if (web && api) edges.push({ id: `${web}-${api}`, source: web, target: api, label: "calls", type: "calls" });
    if (api && data) edges.push({ id: `${api}-${data}`, source: api, target: data, label: "reads/writes", type: "writes" });
    for (let i = 0; i < serviceIds.length - 1; i++) {
      const a = serviceIds[i];
      const b = serviceIds[i + 1];
      edges.push({ id: `${a}-${b}-depends`, source: a, target: b, label: "related", type: "depends_on" });
    }
  } else {
    const structural: StackMapEdge[] = [
      { id: "entry-ui", source: "entrypoints", target: "ui-components", label: "renders", type: "depends_on" },
      { id: "entry-api", source: "entrypoints", target: "api-surface", label: "routes to", type: "routes_to" },
      { id: "api-services", source: "api-surface", target: "services", label: "calls", type: "calls" },
      { id: "services-data", source: "services", target: "data-layer", label: "reads/writes", type: "writes" },
      { id: "tests-api", source: "tests", target: "api-surface", label: "covers", type: "depends_on" },
      { id: "config-entry", source: "configuration", target: "entrypoints", label: "configures", type: "depends_on" },
      { id: "risk-entry", source: "risk-testing-gap", target: "entrypoints", label: "missing coverage", type: "depends_on" }
    ];
    edges.push(...structural);
  }

  return edges.filter((edge) => has(edge.source) && has(edge.target));
}

function buildImportEdges(hints: ImportHint[], nodes: StackMapNode[]): StackMapEdge[] {
  const fileToNode = new Map<string, string>();
  for (const node of nodes) {
    for (const file of node.files) fileToNode.set(file, node.id);
  }

  const edges: StackMapEdge[] = [];
  for (const hint of hints) {
    if (hint.kind !== "relative") continue;
    const sourceNode = fileToNode.get(hint.sourceFile);
    const targetNode = fileToNode.get(hint.target);
    if (!sourceNode || !targetNode || sourceNode === targetNode) continue;
    edges.push({
      id: `import-${sourceNode}-${targetNode}`,
      source: sourceNode,
      target: targetNode,
      label: "imports",
      type: "imports"
    });
  }
  return edges;
}

function buildDefaultTasks(role: EngineerRole, nodes: StackMapNode[]): OnboardingTask[] {
  const nodeIds = nodes.slice(0, 4).map((node) => node.id);
  const roleArea = role === "frontend" ? "frontend" : role === "infra" ? "infra" : role === "qa" ? "testing" : "backend";

  return assignMissionOrder([
    {
      id: "task-map-repo",
      order: 1,
      title: "Read the architecture map",
      difficulty: "easy",
      area: "architecture",
      description: "Walk the graph and name each major node, its files, and one dependency.",
      filesToRead: nodes.flatMap((node) => node.files).slice(0, 6),
      successCriteria: ["Name three nodes", "Cite one evidence file per node", "Explain one edge"],
      estimatedMinutes: 15,
      relatedNodeIds: nodeIds,
      status: "todo"
    },
    {
      id: "task-trace-flow",
      order: 2,
      title: "Trace one user-facing flow",
      difficulty: "medium",
      area: roleArea,
      description: "Pick an entry or API node and follow edges to data or services.",
      filesToRead: nodes.flatMap((node) => node.files).slice(0, 8),
      successCriteria: ["Start from one entry file", "List two downstream files", "Note one edge case"],
      estimatedMinutes: 30,
      relatedNodeIds: nodeIds,
      status: "todo"
    }
  ]);
}

function dedupeTasks(tasks: OnboardingTask[], nodeIds: Set<string>) {
  const seen = new Set<string>();
  const normalized = tasks
    .filter((task) => task.id && task.title && !seen.has(task.id) && (seen.add(task.id), true))
    .map((task) => ({
      ...task,
      order: typeof task.order === "number" ? task.order : undefined,
      filesToRead: cleanFiles(task.filesToRead),
      successCriteria:
        Array.isArray(task.successCriteria) && task.successCriteria.length
          ? task.successCriteria
          : ["Explain what you learned"],
      relatedNodeIds: (task.relatedNodeIds ?? []).filter((id) => nodeIds.has(id)),
      status: task.status ?? "todo"
    }));

  return assignMissionOrder(normalized);
}

function cleanFiles(files: string[] | undefined) {
  if (!Array.isArray(files)) return [];
  return [...new Set(files.filter((file) => typeof file === "string" && file.trim()))].slice(0, 12);
}

export { extractImportHints };
