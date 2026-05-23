import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getNextMission } from "@/lib/mission-path";
import type { ManagedAgentSession } from "@/lib/types";
import type { AnalysisResult, EngineerRole, FamiliarityScore, OnboardingTask, StackMapGraph } from "@/lib/types";

export type JobStatus = "processing" | "complete" | "failed";

export type JobRecord = {
  jobId: string;
  status: JobStatus;
  repoUrl: string;
  role: EngineerRole;
  progress?: string;
  error?: string;
  graph?: StackMapGraph;
  tasks?: OnboardingTask[];
  familiarity?: FamiliarityScore;
  managedAgent?: ManagedAgentSession;
  createdAt: string;
  updatedAt: string;
};

const memory = new Map<string, JobRecord>();
const dataDir = path.join(process.cwd(), ".data", "jobs");

async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

function jobPath(jobId: string) {
  return path.join(dataDir, `${jobId}.json`);
}

async function persistJob(job: JobRecord) {
  memory.set(job.jobId, job);
  try {
    await ensureDataDir();
    await writeFile(jobPath(job.jobId), JSON.stringify(job, null, 2), "utf8");
  } catch (error) {
    console.error("Failed to persist job", job.jobId, error);
  }
}

async function loadJob(jobId: string): Promise<JobRecord | null> {
  const cached = memory.get(jobId);
  if (cached) return cached;

  try {
    const raw = await readFile(jobPath(jobId), "utf8");
    const job = JSON.parse(raw) as JobRecord;
    memory.set(jobId, job);
    return job;
  } catch {
    return null;
  }
}

export async function createJob(input: { jobId: string; repoUrl: string; role: EngineerRole }) {
  const now = new Date().toISOString();
  const job: JobRecord = {
    jobId: input.jobId,
    status: "processing",
    repoUrl: input.repoUrl,
    role: input.role,
    progress: "Cloning repository (this may take a few minutes)...",
    createdAt: now,
    updatedAt: now
  };
  await persistJob(job);
  return job;
}

export async function updateJobManagedSession(jobId: string, managedAgent: ManagedAgentSession) {
  const job = await loadJob(jobId);
  if (!job) return null;
  job.managedAgent = managedAgent;
  job.updatedAt = new Date().toISOString();
  await persistJob(job);
  return job;
}

export async function updateJobProgress(jobId: string, progress: string) {
  const job = await loadJob(jobId);
  if (!job) return null;
  job.progress = progress;
  job.updatedAt = new Date().toISOString();
  await persistJob(job);
  return job;
}

export async function completeJob(jobId: string, result: AnalysisResult) {
  const job = await loadJob(jobId);
  if (!job) return null;

  const updated: JobRecord = {
    ...job,
    status: "complete",
    progress: undefined,
    graph: result.graph,
    tasks: result.tasks,
    familiarity: result.familiarity,
    managedAgent: result.managedAgent ?? job.managedAgent,
    updatedAt: new Date().toISOString()
  };
  await persistJob(updated);
  return updated;
}

export async function failJob(jobId: string, error: string) {
  const job = await loadJob(jobId);
  if (!job) return null;

  const updated: JobRecord = {
    ...job,
    status: "failed",
    error,
    progress: undefined,
    updatedAt: new Date().toISOString()
  };
  await persistJob(updated);
  return updated;
}

export async function getJob(jobId: string) {
  return loadJob(jobId);
}

export function saveAnalysis(result: AnalysisResult) {
  const now = new Date().toISOString();
  const job: JobRecord = {
    jobId: result.jobId,
    status: "complete",
    repoUrl: result.graph.repo.url,
    role: "backend",
    graph: result.graph,
    tasks: result.tasks,
    familiarity: result.familiarity,
    createdAt: now,
    updatedAt: now
  };
  void persistJob(job);
}

export async function getAnalysis(jobId: string): Promise<AnalysisResult | null> {
  const job = await loadJob(jobId);
  if (!job || job.status !== "complete" || !job.graph || !job.tasks || !job.familiarity) return null;
  return {
    jobId: job.jobId,
    graph: job.graph,
    tasks: job.tasks,
    familiarity: job.familiarity,
    managedAgent: job.managedAgent
  };
}

export async function updateTaskStatus(jobId: string, taskId: string, status: OnboardingTask["status"]) {
  const job = await loadJob(jobId);
  if (!job?.tasks) return null;

  job.tasks = job.tasks.map((task) => (task.id === taskId ? { ...task, status } : task));
  job.familiarity = calculateFamiliarity(job.tasks);
  job.updatedAt = new Date().toISOString();
  await persistJob(job);

  if (!job.graph || !job.familiarity) return null;
  return {
    jobId: job.jobId,
    graph: job.graph,
    tasks: job.tasks,
    familiarity: job.familiarity
  };
}

export function calculateFamiliarity(tasks: OnboardingTask[]): FamiliarityScore {
  const done = tasks.filter((task) => task.status === "done");
  const weighted = done.reduce((sum, task) => {
    const weight = task.difficulty === "hard" ? 25 : task.difficulty === "medium" ? 18 : 12;
    return sum + weight;
  }, 0);
  const overall = Math.min(100, 18 + weighted);

  return {
    overall,
    areas: {
      architecture: scoreArea(tasks, "architecture"),
      frontend: scoreArea(tasks, "frontend"),
      backend: scoreArea(tasks, "backend"),
      data: scoreArea(tasks, "data"),
      testing: scoreArea(tasks, "testing"),
      infra: scoreArea(tasks, "infra"),
      riskAwareness: scoreArea(tasks, "risk")
    },
    suggestedNextStep: (() => {
      const next = getNextMission(tasks);
      if (!next) return "All missions complete — pick a real starter issue and open a PR.";
      return `Step ${next.order ?? "?"}: ${next.title}`;
    })()
  };
}

function scoreArea(tasks: OnboardingTask[], area: OnboardingTask["area"]) {
  const matching = tasks.filter((task) => task.area === area);
  if (matching.length === 0) return 10;
  const completed = matching.filter((task) => task.status === "done").length;
  return Math.min(100, 20 + Math.round((completed / matching.length) * 70));
}

export function jobToResponse(job: JobRecord) {
  return {
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    error: job.error,
    graph: job.graph,
    tasks: job.tasks,
    familiarity: job.familiarity,
    managedAgent: job.managedAgent
  };
}
