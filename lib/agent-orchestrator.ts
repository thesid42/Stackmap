import { getGeminiClient } from "@/lib/gemini";
import { managedAgentsEnabled, runManagedStackMapAnalysis } from "@/lib/managed-agents";
import { formatIndexForPrompt, type RepoIndex } from "@/lib/repo-indexer";
import type { EngineerRole, GraphEdgeType, GraphNodeType, ManagedAgentSession, OnboardingTask, StackMapEdge, StackMapNode } from "@/lib/types";

export type AgentRunInput = {
  repoUrl: string;
  role: EngineerRole;
  fileTree: string;
  indexSummary: string;
  snippets: { path: string; content: string }[];
};

export type AgentPartialOutput = {
  agent: string;
  nodes?: StackMapNode[];
  edges?: StackMapEdge[];
  tasks?: OnboardingTask[];
  notes?: string;
};

export const stackMapAgents = [
  {
    id: "service-discovery",
    name: "Service Discovery Agent",
    goal: "Detect single repo vs monorepo, name services/packages, and map workspace boundaries."
  },
  {
    id: "structure",
    name: "Structure Agent",
    goal: "Identify framework, entry points, folders, and app boundaries with file evidence."
  },
  {
    id: "api",
    name: "API Agent",
    goal: "Find routes, controllers, handlers, server actions, and request flows."
  },
  {
    id: "data",
    name: "Data Agent",
    goal: "Find schemas, models, migrations, ORM usage, and data ownership."
  },
  {
    id: "dependency",
    name: "Dependency Agent",
    goal: "Map imports, shared packages, service calls, and coupling between modules."
  },
  {
    id: "risk",
    name: "Risk Agent",
    goal: "Flag missing tests, risky coupling, confusing ownership, and hotspot files."
  },
  {
    id: "task-workflow",
    name: "Task Workflow Agent",
    goal: "Generate role-specific onboarding missions tied to graph nodes and evidence."
  }
] as const;

export function buildGraphPrompt(input: AgentRunInput) {
  return `
You are StackMap, an onboarding agent system for engineering teams.

Analyze this repository and return strict JSON for architecture insights.
Role: ${input.role}
Repo: ${input.repoUrl}

Repository index:
${input.indexSummary}

File tree:
${input.fileTree}

Important snippets:
${input.snippets.map((snippet) => `--- ${snippet.path}\n${snippet.content}`).join("\n\n")}

Return JSON only. Do not include markdown.
`;
}

export type OrchestrationResult = {
  outputs: AgentPartialOutput[];
  managedSession?: ManagedAgentSession;
};

export async function runAgentOrchestration(
  input: AgentRunInput,
  onProgress?: (message: string) => void,
  options?: { sourceType?: string; compactIndex?: boolean }
): Promise<OrchestrationResult> {
  if (managedAgentsEnabled()) {
    try {
      onProgress?.("Antigravity exploring repo in remote sandbox (unified analysis)...");
      const managed = await runManagedStackMapAnalysis({
        repoUrl: input.repoUrl,
        role: input.role,
        indexSummary: input.indexSummary,
        fileTree: input.fileTree,
        sourceType: options?.sourceType ?? "single_repo"
      });
      const parsed = parseAgentJson(managed.output);
      if ((parsed.nodes?.length ?? 0) > 0 || (parsed.tasks?.length ?? 0) > 0) {
        onProgress?.("Managed analysis complete.");
        return {
          managedSession: managed.session,
          outputs: [
            { agent: "managed-unified", nodes: parsed.nodes, edges: parsed.edges },
            { agent: "task-workflow", tasks: parsed.tasks }
          ]
        };
      }
      console.warn("Managed analysis returned empty graph; falling back to specialist agents.");
    } catch (error) {
      console.warn("Managed orchestration failed; falling back to specialist agents.", error);
    }
  }

  const client = getGeminiClient();
  if (!client) return { outputs: [] };

  const outputs = await Promise.all(
    stackMapAgents.map(async (agent) => {
      onProgress?.(`Running ${agent.name}...`);
      try {
        const result = await client.models.generateContent({
          model: process.env.GEMINI_MODEL ?? "gemini-3.5-flash",
          contents: buildAgentPrompt(agent, input)
        });
        const parsed = parseAgentJson(result.text ?? "");
        return { agent: agent.id, ...parsed };
      } catch (error) {
        console.error(`${agent.name} failed`, error);
        return { agent: agent.id, notes: `${agent.name} failed` };
      }
    })
  );

  return { outputs };
}

function buildAgentPrompt(agent: (typeof stackMapAgents)[number], input: AgentRunInput) {
  const shape = {
    nodes: [
      {
        id: "stable-id",
        label: "Name",
        type: "service | entry | api | component | data | config | test | risk | shared_library",
        summary: "Short summary",
        files: ["path/in/repo.ts"],
        evidence: [{ file: "path/in/repo.ts", lines: [1, 20], reason: "Why this matters" }],
        risks: ["optional"],
        suggestedQuestions: ["optional"]
      }
    ],
    edges: [{ id: "a-b", source: "stable-id", target: "other-id", label: "relationship", type: "imports | calls | reads | writes | routes_to | depends_on | publishes" }],
    tasks: [
      {
        id: "task-id",
        order: 1,
        title: "Mission",
        difficulty: "easy | medium | hard",
        area: "architecture | frontend | backend | api | data | testing | infra | risk",
        description: "What to do",
        filesToRead: ["path/in/repo.ts"],
        successCriteria: ["measurable outcome"],
        estimatedMinutes: 20,
        relatedNodeIds: ["stable-id"],
        status: "todo"
      }
    ],
    notes: "optional agent notes"
  };

  const focus =
    agent.id === "task-workflow"
      ? buildTaskWorkflowInstructions(input.role)
      : agent.id === "dependency"
        ? "Prioritize edges[] between nodes with import/call relationships. Return tasks: [] (empty array)."
        : agent.id === "risk"
          ? "Include risk-type nodes and risks[] on affected nodes. Return tasks: [] (empty array)."
          : "Prioritize nodes[] with evidence backed by real file paths. Return tasks: [] (empty array).";

  const shapeForAgent =
    agent.id === "task-workflow"
      ? shape
      : { ...shape, tasks: [] };

  return [
    buildGraphPrompt(input),
    `You are the ${agent.name}. Goal: ${agent.goal}`,
    focus,
    "Return JSON matching this shape:",
    JSON.stringify(shapeForAgent, null, 2)
  ].join("\n\n");
}

function buildTaskWorkflowInstructions(role: EngineerRole) {
  return `
You are the Task Workflow Agent. Create exactly ${5} onboarding missions for a new ${role} engineer on day 1–3.

ONBOARDING means LEARNING the codebase first—not shipping refactors or tickets.

GOOD mission examples:
- "Orient yourself with the architecture map" (read graph + README)
- "Trace one end-to-end request flow" (follow files, explain path)
- "Understand where session/data lives" (read models, no code changes)
- "Review flagged risks before changing code" (read only)
- "Plan a safe first contribution" (describe a small future PR, do not implement)

BAD missions (do NOT generate):
- "Refactor X to use environment variables"
- "Decouple hardcoded IPs"
- "Migrate to Redis" or any production implementation task
- Duplicate missions with nearly the same title

Rules:
- Return exactly 5 tasks with order 1–5, difficulty easy → hard
- Each task: observable learning outcomes in successCriteria (explain, trace, list, identify)
- filesToRead: only paths that exist in the repository index
- relatedNodeIds: must match node ids you or other agents found
- estimatedMinutes: 15–45
- Do not return nodes or edges unless needed; tasks[] is the main output
`.trim();
}

export function parseAgentJson(raw: string): Omit<AgentPartialOutput, "agent"> {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  const withoutFence = trimmed
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start === -1 || end === -1) return {};

  try {
    const parsed = JSON.parse(withoutFence.slice(start, end + 1)) as {
      nodes?: Partial<StackMapNode>[];
      edges?: Partial<StackMapEdge>[];
      tasks?: Partial<OnboardingTask>[];
      notes?: string;
    };

    return {
      nodes: (parsed.nodes ?? []).map((node) => ({
        id: String(node.id ?? ""),
        label: String(node.label ?? "Unknown"),
        type: (node.type ?? "service") as GraphNodeType,
        summary: String(node.summary ?? ""),
        files: Array.isArray(node.files) ? node.files.map(String) : [],
        evidence: Array.isArray(node.evidence) ? node.evidence : [],
        risks: node.risks,
        suggestedQuestions: node.suggestedQuestions
      })),
      edges: (parsed.edges ?? []).map((edge) => ({
        id: String(edge.id ?? `${edge.source}-${edge.target}`),
        source: String(edge.source ?? ""),
        target: String(edge.target ?? ""),
        label: String(edge.label ?? "depends on"),
        type: (edge.type ?? "depends_on") as GraphEdgeType
      })),
      tasks: (parsed.tasks ?? []).map((task) => ({
        id: String(task.id ?? ""),
        title: String(task.title ?? ""),
        difficulty: (task.difficulty ?? "medium") as OnboardingTask["difficulty"],
        area: (task.area ?? "architecture") as OnboardingTask["area"],
        description: String(task.description ?? ""),
        filesToRead: Array.isArray(task.filesToRead) ? task.filesToRead.map(String) : [],
        successCriteria: Array.isArray(task.successCriteria) ? task.successCriteria.map(String) : [],
        estimatedMinutes: Number(task.estimatedMinutes ?? 20),
        order: typeof task.order === "number" ? task.order : undefined,
        relatedNodeIds: Array.isArray(task.relatedNodeIds) ? task.relatedNodeIds.map(String) : [],
        status: (task.status ?? "todo") as OnboardingTask["status"]
      })),
      notes: parsed.notes
    };
  } catch {
    return {};
  }
}

export function buildOrchestratorInput(scan: {
  repo: { displayUrl: string };
  fileTree: string;
  snippets: { path: string; content: string }[];
  index: RepoIndex;
  role: EngineerRole;
  compactIndex?: boolean;
}): AgentRunInput {
  return {
    repoUrl: scan.repo.displayUrl,
    role: scan.role,
    fileTree: scan.fileTree,
    indexSummary: formatIndexForPrompt(scan.index, { compact: scan.compactIndex }),
    snippets: scan.snippets
  };
}
