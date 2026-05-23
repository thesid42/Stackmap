import { readFile } from "node:fs/promises";
import path from "node:path";

export type IndexedFile = {
  path: string;
  language: string;
  size: number;
  kind: "entry" | "route" | "component" | "service" | "model" | "test" | "config" | "unknown";
};

export type RepoService = {
  id: string;
  name: string;
  rootPath: string;
  files: IndexedFile[];
};

export type ImportHint = {
  sourceFile: string;
  target: string;
  kind: "relative" | "package" | "alias";
};

export type RepoIndex = {
  repoUrl: string;
  sourceType: "single_repo" | "monorepo" | "multi_repo";
  workspaceRoots: string[];
  services: RepoService[];
  importantFiles: IndexedFile[];
  importHints: ImportHint[];
};

const ignoredSegments = new Set([".git", "node_modules", ".next", "dist", "build", "coverage", ".turbo"]);
const monorepoRoots = ["apps", "services", "packages"] as const;

export function shouldIndexFile(filePath: string) {
  return !filePath.split("/").some((segment) => ignoredSegments.has(segment));
}

export function classifyFile(filePath: string): IndexedFile["kind"] {
  const lower = filePath.toLowerCase();
  if (lower.includes("test.") || lower.includes(".spec.") || lower.includes("__tests__")) return "test";
  if (lower.includes("route.") || lower.includes("routes") || lower.includes("controller")) return "route";
  if (lower.includes("page.") || lower.includes("main.") || lower.includes("server.") || lower.includes("index.")) return "entry";
  if (lower.includes("model") || lower.includes("schema") || lower.includes("prisma")) return "model";
  if (lower.includes("service") || lower.includes("worker")) return "service";
  if (lower.endsWith(".tsx") || lower.includes("component")) return "component";
  if (lower.includes("docker") || lower.includes("compose") || lower.includes("config") || lower.includes(".env")) return "config";
  return "unknown";
}

export function detectLanguage(filePath: string) {
  if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "TypeScript";
  if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) return "JavaScript";
  if (filePath.endsWith(".py")) return "Python";
  if (filePath.endsWith(".go")) return "Go";
  if (filePath.endsWith(".java")) return "Java";
  if (filePath.endsWith(".rb")) return "Ruby";
  return "Unknown";
}

export async function buildRepoIndex(input: {
  repoUrl: string;
  rootPath: string;
  files: IndexedFile[];
  snippets: { path: string; content: string }[];
  packageJsonContent?: string;
}): Promise<RepoIndex> {
  const packageJson =
    input.packageJsonContent ??
    (await readFile(path.join(input.rootPath, "package.json"), "utf8").catch(() => undefined));

  const workspaceRoots = detectWorkspaceRoots(input.rootPath, input.files, packageJson);
  const sourceType = detectSourceType(input.files, packageJson, workspaceRoots);
  const services = discoverServices(input.files);
  const importantFiles = rankImportantFiles(input.files);
  const importHints = extractImportHints(input.snippets, input.files);

  return {
    repoUrl: input.repoUrl,
    sourceType,
    workspaceRoots,
    services,
    importantFiles,
    importHints
  };
}

function detectWorkspaceRoots(rootPath: string, files: IndexedFile[], packageJson?: string) {
  const roots = new Set<string>();

  if (packageJson?.includes("\"workspaces\"")) {
    roots.add(".");
    try {
      const parsed = JSON.parse(packageJson) as { workspaces?: string[] | { packages?: string[] } };
      const workspaces = Array.isArray(parsed.workspaces)
        ? parsed.workspaces
        : parsed.workspaces && "packages" in parsed.workspaces
          ? parsed.workspaces.packages
          : [];
      for (const pattern of workspaces ?? []) {
        const base = pattern.replace(/\/?\*+$/, "").replace(/\/\*$/, "");
        if (base && base !== ".") roots.add(base);
      }
    } catch {
      // ignore invalid package.json
    }
  }

  for (const marker of ["pnpm-workspace.yaml", "lerna.json", "turbo.json", "nx.json"]) {
    if (files.some((file) => file.path === marker)) roots.add(".");
  }

  for (const root of monorepoRoots) {
    if (files.some((file) => file.path.startsWith(`${root}/`))) roots.add(root);
  }

  if (roots.size === 0) roots.add(rootPath ? "." : ".");
  return [...roots];
}

function detectSourceType(
  files: IndexedFile[],
  packageJson: string | undefined,
  workspaceRoots: string[]
): RepoIndex["sourceType"] {
  if (packageJson?.includes("\"workspaces\"")) return "monorepo";
  if (workspaceRoots.some((root) => monorepoRoots.includes(root as (typeof monorepoRoots)[number]))) return "monorepo";
  if (files.some((file) => monorepoRoots.some((root) => file.path.startsWith(`${root}/`)))) return "monorepo";
  return "single_repo";
}

function discoverServices(files: IndexedFile[]): RepoService[] {
  const byPrefix = new Map<string, IndexedFile[]>();

  for (const file of files) {
    const segments = file.path.split("/");
    const root = segments[0];
    if (!monorepoRoots.includes(root as (typeof monorepoRoots)[number])) continue;

    const serviceRoot =
      segments.length >= 2 ? `${segments[0]}/${segments[1]}` : segments[0];
    const bucket = byPrefix.get(serviceRoot) ?? [];
    bucket.push(file);
    byPrefix.set(serviceRoot, bucket);
  }

  if (byPrefix.size === 0) {
    return [
      {
        id: "root",
        name: "Repository",
        rootPath: ".",
        files
      }
    ];
  }

  return [...byPrefix.entries()]
    .map(([rootPath, serviceFiles]) => ({
      id: slugify(rootPath),
      name: humanizeServiceName(rootPath),
      rootPath,
      files: serviceFiles
    }))
    .sort((a, b) => a.rootPath.localeCompare(b.rootPath));
}

function rankImportantFiles(files: IndexedFile[]) {
  return [...files]
    .sort((a, b) => scoreImportantFile(b) - scoreImportantFile(a))
    .slice(0, 40);
}

function scoreImportantFile(file: IndexedFile) {
  let score = 0;
  if (file.path === "README.md") score += 80;
  if (file.path.endsWith("package.json")) score += 70;
  if (["entry", "route", "service"].includes(file.kind)) score += 35;
  if (file.kind === "model") score += 28;
  if (file.path.includes("app/") || file.path.includes("src/")) score += 15;
  return score;
}

const importPatterns = [
  /import\s+[^'"]+['"]([^'"]+)['"]/g,
  /from\s+['"]([^'"]+)['"]/g,
  /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g
];

export function extractImportHints(
  snippets: { path: string; content: string }[],
  files: IndexedFile[]
): ImportHint[] {
  const fileSet = new Set(files.map((file) => file.path));
  const hints: ImportHint[] = [];
  const seen = new Set<string>();

  for (const snippet of snippets) {
    for (const pattern of importPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(snippet.content))) {
        const target = match[1];
        if (!target || target.startsWith("node:")) continue;

        const kind: ImportHint["kind"] = target.startsWith(".")
          ? "relative"
          : target.startsWith("@/")
            ? "alias"
            : "package";

        const key = `${snippet.path}->${target}`;
        if (seen.has(key)) continue;
        seen.add(key);

        hints.push({ sourceFile: snippet.path, target, kind });
        if (kind === "relative") {
          const resolved = resolveRelativeImport(snippet.path, target);
          if (resolved && fileSet.has(resolved)) {
            const resolvedKey = `${snippet.path}->${resolved}`;
            if (!seen.has(resolvedKey)) {
              seen.add(resolvedKey);
              hints.push({ sourceFile: snippet.path, target: resolved, kind: "relative" });
            }
          }
        }
      }
    }
  }

  return hints.slice(0, 120);
}

function resolveRelativeImport(fromPath: string, importPath: string) {
  const dir = path.posix.dirname(fromPath);
  const joined = path.posix.normalize(path.posix.join(dir, importPath));
  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`
  ];
  return candidates.find((candidate) => !candidate.includes("..")) ?? null;
}

function slugify(value: string) {
  return value.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "service";
}

function humanizeServiceName(rootPath: string) {
  const parts = rootPath.split("/");
  const name = parts[parts.length - 1] ?? rootPath;
  return name
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function formatIndexForPrompt(index: RepoIndex) {
  const services = index.services
    .map(
      (service) =>
        `- ${service.name} (${service.rootPath}, ${service.files.length} files): ${service.files
          .slice(0, 8)
          .map((file) => file.path)
          .join(", ")}`
    )
    .join("\n");

  const hints = index.importHints
    .slice(0, 40)
    .map((hint) => `${hint.sourceFile} -> ${hint.target} (${hint.kind})`)
    .join("\n");

  return [
    `Source type: ${index.sourceType}`,
    `Workspace roots: ${index.workspaceRoots.join(", ") || "."}`,
    `Services:\n${services}`,
    hints ? `Import hints:\n${hints}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}
