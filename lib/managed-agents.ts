import { GoogleGenAI } from "@google/genai";
import { managedAnalysisTimeoutMs } from "@/lib/scan-limits";
import type { EngineerRole, ManagedAgentSession } from "@/lib/types";

export const MANAGED_AGENT_ID = process.env.GEMINI_MANAGED_AGENT ?? "antigravity-preview-05-2026";
const API_REVISION = "2026-05-20";

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({ apiKey });
}

type InteractionRecord = {
  id?: string;
  status?: string;
  environment_id?: string;
  output_text?: string;
  outputs?: Array<{ type?: string; text?: string; content?: string }>;
  steps?: unknown[];
};

export function managedAgentsEnabled() {
  return process.env.STACKMAP_USE_MANAGED_AGENTS !== "0" && Boolean(process.env.GEMINI_API_KEY);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOutputText(interaction: InteractionRecord) {
  if (interaction.output_text?.trim()) return interaction.output_text.trim();
  for (const output of interaction.outputs ?? []) {
    const text = output.text ?? output.content;
    if (typeof text === "string" && text.trim()) return text.trim();
  }
  return "";
}

async function createInteractionRest(body: Record<string, unknown>) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
      "Api-Revision": API_REVISION
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json().catch(() => null)) as InteractionRecord & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Managed agent request failed (${response.status}).`);
  }
  return payload;
}

async function getInteractionRest(id: string) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions/${encodeURIComponent(id)}`, {
    headers: {
      "x-goog-api-key": apiKey,
      "Api-Revision": API_REVISION
    }
  });

  const payload = (await response.json().catch(() => null)) as InteractionRecord & { error?: { message?: string } };
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `Managed agent poll failed (${response.status}).`);
  }
  return payload;
}

async function createInteraction(body: Record<string, unknown>) {
  const client = getClient();
  if (client?.interactions?.create) {
    try {
      return (await client.interactions.create(body as never)) as InteractionRecord;
    } catch (error) {
      console.warn("SDK interactions.create failed, falling back to REST.", error);
    }
  }
  return createInteractionRest(body);
}

async function getInteraction(id: string) {
  const client = getClient();
  if (client?.interactions?.get) {
    try {
      return (await client.interactions.get(id)) as InteractionRecord;
    } catch (error) {
      console.warn("SDK interactions.get failed, falling back to REST.", error);
    }
  }
  return getInteractionRest(id);
}

async function waitForInteraction(id: string, timeoutMs = 120_000) {
  const started = Date.now();
  let latest = await getInteraction(id);

  while (Date.now() - started < timeoutMs) {
    if (latest.status === "completed") return latest;
    if (latest.status && ["failed", "cancelled", "incomplete", "budget_exceeded"].includes(latest.status)) {
      throw new Error(`Managed agent ended with status ${latest.status}.`);
    }
    await sleep(2500);
    latest = await getInteraction(id);
  }

  throw new Error("Managed agent timed out.");
}

function toSession(interaction: InteractionRecord): ManagedAgentSession {
  return {
    agent: MANAGED_AGENT_ID,
    interactionId: interaction.id ?? "",
    environmentId: interaction.environment_id,
    stepCount: Array.isArray(interaction.steps) ? interaction.steps.length : undefined,
    bootstrappedAt: new Date().toISOString()
  };
}

export async function bootstrapManagedRepoSession(repoUrl: string, role: string) {
  const input = [
    "You are StackMap's Antigravity managed onboarding agent.",
    `Repository: ${repoUrl}`,
    `Onboarding role: ${role}`,
    "Use the remote sandbox to inspect this public GitHub repository.",
    "Summarize the top-level architecture, main services or packages, and 5 important file paths a new engineer should read first.",
    "Keep the answer practical and source-backed."
  ].join("\n");

  const created = await createInteraction({
    agent: MANAGED_AGENT_ID,
    environment: buildGitRemoteEnvironment(repoUrl),
    input
  });

  if (!created.id) throw new Error("Managed agent returned no interaction id.");
  const completed = created.status === "completed" ? created : await waitForInteraction(created.id);
  return toSession(completed);
}

function normalizeGitHubRepoUrl(repoUrl: string) {
  return repoUrl.replace(/\.git$/i, "").replace(/\/+$/, "");
}

export function buildGitRemoteEnvironment(repoUrl: string) {
  return {
    type: "remote",
    sources: [
      {
        type: "repository",
        source: normalizeGitHubRepoUrl(repoUrl),
        target: "/workspace/repo"
      }
    ]
  };
}

function buildManagedAnalysisPrompt(params: {
  repoUrl: string;
  role: EngineerRole;
  indexSummary: string;
  fileTree: string;
  sourceType: string;
}) {
  const monorepoHint =
    params.sourceType === "monorepo"
      ? "This is a monorepo — focus on the 6–10 most important services/packages, not every folder."
      : "Focus on the main application boundaries and entry points.";

  return [
    "You are StackMap, an onboarding agent for engineering teams.",
    `Repository URL: ${params.repoUrl}`,
    `New engineer role: ${params.role}`,
    "The full source is mounted at /workspace/repo in your remote sandbox.",
    "Use shell and file tools to explore the repo directly — do not rely only on the hints below.",
    monorepoHint,
    "",
    "Local index hints (may be incomplete for large repos):",
    params.indexSummary,
    "",
    "File tree summary:",
    params.fileTree,
    "",
    "Return strict JSON only (no markdown). Shape:",
    JSON.stringify(
      {
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
        edges: [
          {
            id: "a-b",
            source: "stable-id",
            target: "other-id",
            label: "relationship",
            type: "imports | calls | reads | writes | routes_to | depends_on | publishes"
          }
        ],
        tasks: [
          {
            id: "task-id",
            order: 1,
            title: "Mission",
            difficulty: "easy | medium | hard",
            area: "architecture | frontend | backend | api | data | testing | infra | risk",
            description: "What to learn",
            filesToRead: ["path/in/repo.ts"],
            successCriteria: ["measurable learning outcome"],
            estimatedMinutes: 20,
            relatedNodeIds: ["stable-id"],
            status: "todo"
          }
        ]
      },
      null,
      2
    ),
    "",
    "Rules:",
    "- Return up to 20 nodes and 30 edges with real file evidence from /workspace/repo",
    "- Return exactly 5 onboarding tasks (learning missions, not refactor tickets) for a new " + params.role + " engineer",
    "- filesToRead and evidence.file must be paths that exist in the repo",
    "- Task order 1–5, difficulty easy → hard, estimatedMinutes 15–45"
  ].join("\n");
}

export async function runManagedStackMapAnalysis(params: {
  repoUrl: string;
  role: EngineerRole;
  indexSummary: string;
  fileTree: string;
  sourceType: string;
}) {
  const input = buildManagedAnalysisPrompt(params);
  const created = await createInteraction({
    agent: MANAGED_AGENT_ID,
    environment: buildGitRemoteEnvironment(params.repoUrl),
    input,
    system_instruction:
      "Explore /workspace/repo with tools. Return strict JSON matching the requested shape — no markdown fences or prose."
  });

  if (!created.id) throw new Error("Managed analysis returned no interaction id.");

  const completed =
    created.status === "completed"
      ? created
      : await waitForInteraction(created.id, managedAnalysisTimeoutMs());

  const output = extractOutputText(completed);
  if (!output) throw new Error("Managed analysis returned no text.");

  return {
    output,
    session: toSession(completed)
  };
}

export async function askManagedMentor(input: string, session: ManagedAgentSession) {
  const body: Record<string, unknown> = {
    agent: session.agent || MANAGED_AGENT_ID,
    input,
    previous_interaction_id: session.interactionId
  };

  if (session.environmentId) {
    body.environment = session.environmentId;
  }

  const created = await createInteraction(body);
  if (!created.id) throw new Error("Managed mentor returned no interaction id.");

  const completed = created.status === "completed" ? created : await waitForInteraction(created.id, 90_000);
  const answer = extractOutputText(completed);
  if (!answer) throw new Error("Managed mentor returned no text.");

  return {
    answer,
    session: {
      ...session,
      interactionId: completed.id ?? created.id,
      environmentId: completed.environment_id ?? session.environmentId,
      stepCount: Array.isArray(completed.steps) ? completed.steps.length : session.stepCount
    } satisfies ManagedAgentSession
  };
}
