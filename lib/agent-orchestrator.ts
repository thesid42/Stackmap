import type { EngineerRole, OnboardingTask, StackMapGraph } from "@/lib/types";

export type AgentRunInput = {
  repoUrl: string;
  role: EngineerRole;
  fileTree: string;
  snippets: { path: string; content: string }[];
};

export type AgentRunOutput = {
  graph: StackMapGraph;
  tasks: OnboardingTask[];
};

export const stackMapAgentPlan = [
  {
    name: "Service Discovery Agent",
    goal: "Detect whether the source is a single repo, monorepo, or multi-service platform."
  },
  {
    name: "Structure Agent",
    goal: "Identify framework, entry points, app boundaries, and important folders."
  },
  {
    name: "API Agent",
    goal: "Find routes, controllers, handlers, server actions, and request flows."
  },
  {
    name: "Data Agent",
    goal: "Find schemas, models, migrations, ORM usage, and data ownership."
  },
  {
    name: "Dependency Agent",
    goal: "Map imports, shared packages, service calls, and event dependencies."
  },
  {
    name: "Risk Agent",
    goal: "Flag missing tests, risky coupling, confusing ownership, and hotspot files."
  },
  {
    name: "Task Workflow Agent",
    goal: "Generate role-specific onboarding missions tied to graph nodes and source evidence."
  }
] as const;

export function buildGraphPrompt(input: AgentRunInput) {
  return `
You are StackMap, an onboarding agent system for engineering teams.

Analyze this repository and return strict JSON for:
1. Architecture graph nodes and edges
2. Role-specific onboarding missions for a ${input.role}
3. Source-backed evidence for every important claim

Repo URL:
${input.repoUrl}

File tree:
${input.fileTree}

Important snippets:
${input.snippets.map((snippet) => `--- ${snippet.path}\n${snippet.content}`).join("\n\n")}

Return JSON only. Do not include markdown.
`;
}
