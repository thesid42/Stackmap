import { randomUUID } from "node:crypto";
import { buildOrchestratorInput, runAgentOrchestration } from "@/lib/agent-orchestrator";
import {
  calculateFamiliarity,
  completeJob,
  createJob,
  failJob,
  getJob,
  updateJobManagedSession,
  updateJobProgress
} from "@/lib/analysis-store";
import { mergeAgentOutputs, normalizeGraph } from "@/lib/graph-builder";
import { buildRepoIndex } from "@/lib/repo-indexer";
import { cloneRepository, isRepositoryCached, scanRepository } from "@/lib/repo-scanner";
import { buildAnalysisResult } from "@/lib/sample-data";
import type { AnalysisResult, EngineerRole, StackMapGraph } from "@/lib/types";

function shouldUseSampleGraph(repoUrl: string) {
  return process.env.STACKMAP_USE_SAMPLE === "1" || /example\/stackmap-demo/i.test(repoUrl);
}

export async function startAnalysisJob(repoUrl: string, role: EngineerRole): Promise<{ jobId: string }> {
  const jobId = randomUUID();
  await createJob({ jobId, repoUrl, role });

  void runAnalysisJob(jobId, repoUrl, role).catch(async (error) => {
    console.error("Analysis job failed", jobId, error);
    await failJob(jobId, error instanceof Error ? error.message : "Analysis failed");
  });

  return { jobId };
}

async function runAnalysisJob(jobId: string, repoUrl: string, role: EngineerRole) {
  if (shouldUseSampleGraph(repoUrl)) {
    await updateJobProgress(jobId, "Loading demo knowledge graph...");
    const result = buildAnalysisResult(repoUrl, role, jobId);
    await completeJob(jobId, result);
    return;
  }

  try {
    const cached = await isRepositoryCached(repoUrl);
    await updateJobProgress(
      jobId,
      cached
        ? "Using cached repository..."
        : "Cloning repository (this may take a few minutes)..."
    );
    const cloned = await cloneRepository(repoUrl);

    await updateJobProgress(jobId, "Indexing codebase...");
    const scan = await scanRepository(cloned.repo, cloned.rootPath);

    const index = await buildRepoIndex({
      repoUrl: scan.repo.displayUrl,
      rootPath: cloned.rootPath,
      files: scan.files,
      snippets: scan.snippets,
      packageJsonContent: scan.snippets.find((snippet) => snippet.path === "package.json")?.content
    });

    const repoMeta: StackMapGraph["repo"] = {
      name: scan.repo.name,
      url: scan.repo.displayUrl,
      sourceType: index.sourceType,
      language: scan.language,
      framework: scan.framework
    };

    await updateJobProgress(jobId, "Running architecture analysis...");
    const orchestratorInput = buildOrchestratorInput({
      repo: scan.repo,
      fileTree: scan.fileTree,
      snippets: scan.snippets,
      index,
      role,
      compactIndex: scan.limits.compactTree
    });

    const { outputs: agentOutputs, managedSession } = await runAgentOrchestration(
      orchestratorInput,
      (message) => {
        void updateJobProgress(jobId, message);
      },
      { sourceType: index.sourceType, compactIndex: scan.limits.compactTree }
    );

    if (managedSession) {
      await updateJobManagedSession(jobId, managedSession);
    }

    await updateJobProgress(jobId, "Building architecture graph...");
    const merged = mergeAgentOutputs({
      repo: repoMeta,
      index,
      agentOutputs,
      role,
      snippets: scan.snippets
    });

    const { graph, tasks } = normalizeGraph(merged.graph, merged.tasks);
    const job = await getJob(jobId);
    const result: AnalysisResult = {
      jobId,
      graph,
      tasks,
      familiarity: calculateFamiliarity(tasks),
      managedAgent: job?.managedAgent
    };

    await completeJob(jobId, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    await failJob(jobId, message);
    throw error;
  }
}
