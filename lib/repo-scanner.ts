import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { classifyFile, detectLanguage, shouldIndexFile, type IndexedFile } from "@/lib/repo-indexer";

const execFileAsync = promisify(execFile);

const maxIndexedFiles = 500;
const maxSnippetFiles = 55;
const maxFileBytes = 180_000;
const maxSnippetChars = 3_500;
const maxPromptChars = 95_000;

const binaryExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".mp4",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".wasm"
]);

export type RepoIdentity = {
  owner: string;
  name: string;
  cloneUrl: string;
  displayUrl: string;
};

export type RepoSnippet = {
  path: string;
  content: string;
};

export type RepoScan = {
  repo: RepoIdentity;
  rootPath: string;
  files: IndexedFile[];
  fileTree: string;
  snippets: RepoSnippet[];
  language: string;
  framework?: string;
  sourceType: "single_repo" | "monorepo" | "multi_repo";
};

export function parseGitHubRepoUrl(repoUrl: string): RepoIdentity {
  const parsed = new URL(repoUrl);
  if (parsed.hostname !== "github.com") {
    throw new Error("Only public github.com repository URLs are supported for this MVP.");
  }

  const [owner, rawName] = parsed.pathname.split("/").filter(Boolean);
  const name = rawName?.replace(/\.git$/i, "");
  if (!owner || !name) {
    throw new Error("Use a GitHub repo URL like https://github.com/org/repo.");
  }

  return {
    owner,
    name,
    cloneUrl: `https://github.com/${owner}/${name}.git`,
    displayUrl: `https://github.com/${owner}/${name}`
  };
}

export async function cloneRepository(repoUrl: string) {
  const repo = parseGitHubRepoUrl(repoUrl);
  const parent = await mkdtemp(path.join(tmpdir(), "stackmap-"));
  const rootPath = path.join(parent, repo.name);

  await execFileAsync("git", ["clone", "--depth", "1", "--single-branch", repo.cloneUrl, rootPath], {
    timeout: 90_000,
    maxBuffer: 1024 * 1024
  });

  return { repo, rootPath, cleanup: () => rm(parent, { recursive: true, force: true }) };
}

export async function scanRepository(repo: RepoIdentity, rootPath: string): Promise<RepoScan> {
  const files = await walkFiles(rootPath);
  const indexed = files
    .filter((file) => shouldIndexFile(file.relativePath))
    .filter((file) => file.size <= maxFileBytes)
    .filter((file) => !binaryExtensions.has(path.extname(file.relativePath).toLowerCase()))
    .slice(0, maxIndexedFiles)
    .map((file) => ({
      path: file.relativePath,
      language: detectLanguage(file.relativePath),
      size: file.size,
      kind: classifyFile(file.relativePath)
    }));

  const snippets = await collectSnippets(rootPath, indexed);
  const packageJson = snippets.find((snippet) => snippet.path === "package.json")?.content;

  return {
    repo,
    rootPath,
    files: indexed,
    fileTree: buildFileTree(indexed),
    snippets,
    language: detectPrimaryLanguage(indexed),
    framework: detectFramework(indexed, packageJson),
    sourceType: detectSourceType(indexed, packageJson)
  };
}

async function walkFiles(rootPath: string, currentPath = rootPath): Promise<{ fullPath: string; relativePath: string; size: number }[]> {
  const entries = await readdir(currentPath, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(currentPath, entry.name);
      const relativePath = toRepoPath(path.relative(rootPath, fullPath));

      if (entry.isDirectory()) {
        if (!shouldIndexFile(relativePath)) return [];
        return walkFiles(rootPath, fullPath);
      }

      if (!entry.isFile()) return [];
      const info = await stat(fullPath);
      return [{ fullPath, relativePath, size: info.size }];
    })
  );

  return results.flat();
}

async function collectSnippets(rootPath: string, files: IndexedFile[]) {
  const ranked = [...files].sort((a, b) => scoreFile(b) - scoreFile(a)).slice(0, maxSnippetFiles);
  const snippets: RepoSnippet[] = [];
  let totalChars = 0;

  for (const file of ranked) {
    if (totalChars >= maxPromptChars) break;
    const fullPath = path.join(rootPath, file.path);
    const content = await readFile(fullPath, "utf8").catch(() => "");
    if (!content.trim()) continue;

    const clipped = content.slice(0, maxSnippetChars);
    totalChars += clipped.length;
    snippets.push({ path: file.path, content: clipped });
  }

  return snippets;
}

function scoreFile(file: IndexedFile) {
  let score = 0;
  if (file.path === "README.md") score += 70;
  if (file.path === "package.json") score += 70;
  if (file.path.includes("app/") || file.path.includes("src/")) score += 20;
  if (["entry", "route", "service", "model", "config"].includes(file.kind)) score += 35;
  if (file.kind === "component") score += 18;
  if (file.kind === "test") score += 8;
  if (file.size < 25_000) score += 10;
  return score;
}

function buildFileTree(files: IndexedFile[]) {
  return files
    .slice(0, maxIndexedFiles)
    .map((file) => `${file.path} (${file.kind}, ${file.language}, ${file.size} bytes)`)
    .join("\n");
}

function detectPrimaryLanguage(files: IndexedFile[]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    if (file.language === "Unknown") continue;
    counts.set(file.language, (counts.get(file.language) ?? 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Unknown";
}

function detectFramework(files: IndexedFile[], packageJson?: string) {
  const packageLower = packageJson?.toLowerCase() ?? "";
  if (packageLower.includes("\"next\"")) return "Next.js";
  if (packageLower.includes("\"@remix-run/")) return "Remix";
  if (packageLower.includes("\"vite\"") && packageLower.includes("\"react\"")) return "Vite + React";
  if (packageLower.includes("\"express\"")) return "Express";
  if (files.some((file) => file.path.includes("fastapi") || file.path.includes("main.py"))) return "FastAPI";
  if (files.some((file) => file.path.endsWith("go.mod"))) return "Go";
  return undefined;
}

function detectSourceType(files: IndexedFile[], packageJson?: string): RepoScan["sourceType"] {
  if (packageJson?.includes("\"workspaces\"")) return "monorepo";
  if (files.some((file) => file.path.startsWith("apps/") || file.path.startsWith("services/") || file.path.startsWith("packages/"))) {
    return "monorepo";
  }
  return "single_repo";
}

function toRepoPath(value: string) {
  return value.split(path.sep).join("/");
}
