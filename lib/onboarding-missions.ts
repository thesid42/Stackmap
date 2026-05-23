import { assignMissionOrder } from "@/lib/mission-path";
import type { EngineerRole, OnboardingTask, StackMapNode } from "@/lib/types";

export const MAX_ONBOARDING_MISSIONS = 5;

/** Titles/descriptions that read like Jira tickets, not week-one onboarding. */
const IMPLEMENTATION_PATTERNS =
  /\b(refactor|migrate|decouple|hardcoded|implement\s+redis|replace\s+all|configure\s+.*\s+env|fix\s+the\s+bug|add\s+validation\s+to|remove\s+hardcoded|update\s+.*\s+to\s+use)\b/i;

const LEARNING_PATTERNS = /\b(read|trace|map|walk|identify|explain|understand|review|document|draw|list|follow|explore|summarize|locate|find\s+where)\b/i;

export function isOnboardingStyleMission(task: OnboardingTask): boolean {
  const text = `${task.title} ${task.description}`;
  if (!LEARNING_PATTERNS.test(text) && IMPLEMENTATION_PATTERNS.test(text)) return false;
  if (task.successCriteria.some((c) => IMPLEMENTATION_PATTERNS.test(c) && !LEARNING_PATTERNS.test(c))) return false;
  return true;
}

function titleKey(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .slice(0, 5)
    .join(" ");
}

export function curateOnboardingMissions(tasks: OnboardingTask[]): OnboardingTask[] {
  const seenTitles = new Set<string>();
  const curated = tasks.filter((task) => {
    if (!isOnboardingStyleMission(task)) return false;
    const key = titleKey(task.title);
    if (seenTitles.has(key)) return false;
    seenTitles.add(key);
    return true;
  });

  return assignMissionOrder(curated).slice(0, MAX_ONBOARDING_MISSIONS);
}

export function buildOnboardingMissionsFromGraph(role: EngineerRole, nodes: StackMapNode[]): OnboardingTask[] {
  const entry = nodes.find((n) => n.type === "entry" || n.type === "api");
  const data = nodes.find((n) => n.type === "data");
  const risk = nodes.find((n) => n.type === "risk");
  const service = nodes.find((n) => n.type === "service");
  const roleArea =
    role === "frontend" ? "frontend" : role === "infra" ? "infra" : role === "qa" ? "testing" : "backend";

  const allFiles = nodes.flatMap((n) => n.files);
  const entryFiles = entry?.files?.length ? entry.files : allFiles.slice(0, 4);
  const flowFiles = [...(entry?.files ?? []), ...(service?.files ?? []), ...(data?.files ?? [])].slice(0, 8);
  const riskFiles = risk?.files?.length ? risk.files : allFiles.slice(0, 4);

  const related = (ids: (string | undefined)[]) => ids.filter((id): id is string => !!id);

  return assignMissionOrder([
    {
      id: "onboard-map",
      order: 1,
      title: "Orient yourself with the architecture map",
      difficulty: "easy",
      area: "architecture",
      description:
        "Before changing code, walk the StackMap graph. For each major node, note what it owns and which files prove it.",
      filesToRead: allFiles.slice(0, 6),
      successCriteria: [
        "Name at least three nodes and what each owns",
        "Open one evidence file per node and state what it proves",
        "Describe one dependency edge in plain language"
      ],
      estimatedMinutes: 20,
      relatedNodeIds: related(nodes.slice(0, 4).map((n) => n.id)),
      status: "todo"
    },
    {
      id: "onboard-trace",
      order: 2,
      title: "Trace one end-to-end user flow",
      difficulty: "medium",
      area: roleArea,
      description:
        "Pick a likely entrypoint or API route and follow imports/calls until you reach data or an external service. Do not change code yet.",
      filesToRead: flowFiles.length ? flowFiles : allFiles.slice(0, 8),
      successCriteria: [
        "Start from one entry file and name the next two files in the chain",
        "Explain what happens on a happy path",
        "Note one edge case or failure mode"
      ],
      estimatedMinutes: 35,
      relatedNodeIds: related([entry?.id, service?.id, data?.id]),
      status: "todo"
    },
    {
      id: "onboard-data",
      order: 3,
      title: "Understand where state and data live",
      difficulty: "medium",
      area: "data",
      description:
        "Find schemas, models, or session storage. Summarize what data is persisted, where, and which service owns it.",
      filesToRead: (data?.files ?? allFiles.filter((f) => /model|schema|session|db/i.test(f))).slice(0, 6),
      successCriteria: [
        "Identify the main data models or session store",
        "Explain which service reads and writes that data",
        "List one risk if this store fails or resets"
      ],
      estimatedMinutes: 30,
      relatedNodeIds: related([data?.id, service?.id]),
      status: "todo"
    },
    {
      id: "onboard-risk",
      order: 4,
      title: "Review flagged risks before you ship",
      difficulty: "easy",
      area: "risk",
      description:
        "Read risk nodes and hotspots. Your goal is to learn what is fragile—not to fix everything on day one.",
      filesToRead: riskFiles,
      successCriteria: [
        "List two risks called out on the map",
        "Explain why each matters for onboarding",
        "Pick one risk you would address in a future PR (no code required now)"
      ],
      estimatedMinutes: 20,
      relatedNodeIds: related([risk?.id, entry?.id]),
      status: "todo"
    },
    {
      id: "onboard-first-pr",
      order: 5,
      title: "Plan a safe first contribution",
      difficulty: "medium",
      area: role === "qa" ? "testing" : roleArea,
      description:
        "Propose a small, low-risk change (test, log, doc, or narrow fix). Write what you would change, why it is safe, and how you would verify it.",
      filesToRead: entryFiles,
      successCriteria: [
        "Describe a change under ~40 lines",
        "List files you would touch and why",
        "Name the manual check or test you would run"
      ],
      estimatedMinutes: 40,
      relatedNodeIds: related([entry?.id, risk?.id]),
      status: "todo"
    }
  ]);
}
