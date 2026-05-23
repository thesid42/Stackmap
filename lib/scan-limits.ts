export type ScanLimits = {
  maxIndexedFiles: number;
  maxSnippetFiles: number;
  maxFileBytes: number;
  maxSnippetChars: number;
  maxPromptChars: number;
  maxWalkFiles: number;
  compactTree: boolean;
};

const defaultLimits: ScanLimits = {
  maxIndexedFiles: 500,
  maxSnippetFiles: 55,
  maxFileBytes: 180_000,
  maxSnippetChars: 3_500,
  maxPromptChars: 95_000,
  maxWalkFiles: 8_000,
  compactTree: false
};

const largeRepoLimits: ScanLimits = {
  maxIndexedFiles: 320,
  maxSnippetFiles: 24,
  maxFileBytes: 120_000,
  maxSnippetChars: 2_200,
  maxPromptChars: 42_000,
  maxWalkFiles: 4_000,
  compactTree: true
};

function envInt(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getScanLimits(walkedFileCount: number): ScanLimits {
  const largeThreshold = envInt("STACKMAP_LARGE_REPO_WALK_THRESHOLD", 1_200);
  const forceLarge = process.env.STACKMAP_LARGE_REPO === "1";

  if (forceLarge || walkedFileCount >= largeThreshold) {
    return {
      ...largeRepoLimits,
      maxIndexedFiles: envInt("STACKMAP_MAX_INDEXED_FILES", largeRepoLimits.maxIndexedFiles),
      maxSnippetFiles: envInt("STACKMAP_MAX_SNIPPET_FILES", largeRepoLimits.maxSnippetFiles)
    };
  }

  return {
    ...defaultLimits,
    maxIndexedFiles: envInt("STACKMAP_MAX_INDEXED_FILES", defaultLimits.maxIndexedFiles),
    maxSnippetFiles: envInt("STACKMAP_MAX_SNIPPET_FILES", defaultLimits.maxSnippetFiles)
  };
}

export function managedAnalysisTimeoutMs() {
  return envInt("STACKMAP_MANAGED_TIMEOUT_MS", 180_000);
}
