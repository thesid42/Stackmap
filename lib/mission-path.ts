import type { OnboardingTask } from "@/lib/types";

const difficultyRank: Record<OnboardingTask["difficulty"], number> = {
  easy: 0,
  medium: 1,
  hard: 2
};

export function sortMissions(tasks: OnboardingTask[]): OnboardingTask[] {
  return [...tasks].sort((a, b) => {
    const orderA = a.order ?? 999;
    const orderB = b.order ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return difficultyRank[a.difficulty] - difficultyRank[b.difficulty];
  });
}

export function assignMissionOrder(tasks: OnboardingTask[]): OnboardingTask[] {
  const sorted = sortMissions(tasks);
  return sorted.map((task, index) => ({
    ...task,
    order: task.order ?? index + 1
  }));
}

export function isMissionLocked(sortedTasks: OnboardingTask[], index: number): boolean {
  for (let i = 0; i < index; i++) {
    if (sortedTasks[i].status !== "done") return true;
  }
  return false;
}

export function getNextMission(tasks: OnboardingTask[]): OnboardingTask | undefined {
  const sorted = sortMissions(tasks);
  const index = sorted.findIndex((task, i) => task.status !== "done" && !isMissionLocked(sorted, i));
  return index >= 0 ? sorted[index] : undefined;
}

export function missionProgress(tasks: OnboardingTask[]) {
  const sorted = sortMissions(tasks);
  const done = sorted.filter((task) => task.status === "done").length;
  return { done, total: sorted.length, sorted };
}
