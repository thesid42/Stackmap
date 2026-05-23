export type IndexedFile = {
  path: string;
  language: string;
  size: number;
  kind: "entry" | "route" | "component" | "service" | "model" | "test" | "config" | "unknown";
};

export type RepoIndex = {
  repoUrl: string;
  sourceType: "single_repo" | "monorepo" | "multi_repo";
  services: {
    id: string;
    name: string;
    rootPath: string;
    files: IndexedFile[];
  }[];
  importantFiles: IndexedFile[];
};

const ignoredSegments = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo"]);

export function shouldIndexFile(path: string) {
  return !path.split("/").some((segment) => ignoredSegments.has(segment));
}

export function classifyFile(path: string): IndexedFile["kind"] {
  const lower = path.toLowerCase();
  if (lower.includes("test.") || lower.includes(".spec.") || lower.includes("__tests__")) return "test";
  if (lower.includes("route.") || lower.includes("routes") || lower.includes("controller")) return "route";
  if (lower.includes("page.") || lower.includes("main.") || lower.includes("server.") || lower.includes("index.")) return "entry";
  if (lower.includes("model") || lower.includes("schema") || lower.includes("prisma")) return "model";
  if (lower.includes("service") || lower.includes("worker")) return "service";
  if (lower.endsWith(".tsx") || lower.includes("component")) return "component";
  if (lower.includes("docker") || lower.includes("compose") || lower.includes("config") || lower.includes(".env")) return "config";
  return "unknown";
}

export function detectLanguage(path: string) {
  if (path.endsWith(".ts") || path.endsWith(".tsx")) return "TypeScript";
  if (path.endsWith(".js") || path.endsWith(".jsx")) return "JavaScript";
  if (path.endsWith(".py")) return "Python";
  if (path.endsWith(".go")) return "Go";
  if (path.endsWith(".java")) return "Java";
  if (path.endsWith(".rb")) return "Ruby";
  return "Unknown";
}
