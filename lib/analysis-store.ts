import type { AnalysisResult, FamiliarityScore, OnboardingTask } from "@/lib/types";

const store = new Map<string, AnalysisResult>();

export function saveAnalysis(result: AnalysisResult) {
  store.set(result.jobId, result);
}

export function getAnalysis(jobId: string) {
  return store.get(jobId);
}

export function updateTaskStatus(jobId: string, taskId: string, status: OnboardingTask["status"]) {
  const result = store.get(jobId);
  if (!result) return null;

  result.tasks = result.tasks.map((task) => (task.id === taskId ? { ...task, status } : task));
  result.familiarity = calculateFamiliarity(result.tasks);
  store.set(jobId, result);
  return result;
}

function calculateFamiliarity(tasks: OnboardingTask[]): FamiliarityScore {
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
    suggestedNextStep: tasks.find((task) => task.status !== "done")?.title ?? "Pick a real starter issue and make a first PR."
  };
}

function scoreArea(tasks: OnboardingTask[], area: OnboardingTask["area"]) {
  const matching = tasks.filter((task) => task.area === area);
  if (matching.length === 0) return 10;
  const completed = matching.filter((task) => task.status === "done").length;
  return Math.min(100, 20 + Math.round((completed / matching.length) * 70));
}
