import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { classifyFile, detectLanguage, shouldIndexFile, type IndexedFile } from "@/lib/repo-indexer";

const execFileAsync = promisify(execFile);

const defaultCloneTimeoutMs = 300_000;

function cloneTimeoutMs() {
  const raw = process.env.STACKMAP_CLONE_TIMEOUT_MS;
  if (!raw) return defaultCloneTimeoutMs;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultCloneTimeoutMs;
}

type ExecFileError = NodeJS.ErrnoException & {
  killed?: boolean;
  signal?: string;
  stderr?: string | Buffer;
  stdout?: string | Buffer;
};

function execOutput(error: ExecFileError) {
  const parts = [error.stderr, error.stdout, error.message].filter(Boolean);
  return parts
    .map((part) => (Buffer.isBuffer(part) ? part.toString("utf8") : String(part)))
    .join("\n")
    .toLowerCase();
}

/** Maps git clone failures to messages suitable for the analysis job UI. */
export function formatGitCloneError(error: unknown, repo?: Pick<RepoIdentity, "displayUrl" | "name">) {
  const execErr = error as ExecFileError;
  const output = execOutput(execErr);
  const repoLabel = repo?.displayUrl ?? repo?.name ?? "the repository";
  const timeoutMinutes = Math.max(1, Math.round(cloneTimeoutMs() / 60_000));

  if (execErr.killed && execErr.signal === "SIGTERM") {
    return `Cloning ${repoLabel} timed out after ${timeoutMinutes} minutes. Large repos or slow networks may need a longer limit — set STACKMAP_CLONE_TIMEOUT_MS (currently ${cloneTimeoutMs()} ms).`;
  }

  if (
    output.includes("repository not found") ||
    output.includes("remote repository not found") ||
    /fatal:.*repository.*not found/.test(output) ||
    output.includes("could not read from remote repository")
  ) {
    return `Repository not found or not accessible: ${repoLabel}. Check that the URL is correct and the repo is public.`;
  }

  if (
    output.includes("authentication failed") ||
    output.includes("could not read username") ||
    output.includes("invalid username or password") ||
    output.includes("permission denied") ||
    output.includes("access rights") ||
    output.includes("403") ||
    output.includes("401")
  ) {
    return `Cannot access ${repoLabel}. Private repos are not supported yet — use a public GitHub URL.`;
  }

  if (
    output.includes("could not resolve host") ||
    output.includes("connection refused") ||
    output.includes("failed to connect") ||
    output.includes("network is unreachable") ||
    output.includes("unable to access") ||
    output.includes("connection timed out") ||
    output.includes("operation timed out") ||
    execErr.code === "ETIMEDOUT" ||
    execErr.code === "ENOTFOUND" ||
    execErr.code === "ECONNREFUSED"
  ) {
    return `Network error while cloning ${repoLabel}. Check your internet connection and try again.`;
  }

  if (error instanceof Error && error.message && !error.message.startsWith("Command failed:")) {
    return error.message;
  }

  const detail = [execErr.stderr, execErr.stdout]
    .map((part) => (Buffer.isBuffer(part) ? part.toString("utf8").trim() : part?.trim()))
    .filter(Boolean)
    .join("\n");

  return detail
    ? `Failed to clone ${repoLabel}: ${detail.split("\n").slice(-3).join(" ")}`
    : `Failed to clone ${repoLabel}. Verify the GitHub URL and try again.`;
}

/** All clones live under the OS temp directory and are removed after analysis. */
const cloneTempPrefix = () => path.join(tmpdir(), "stackmap-clone-");

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
  const rootPath = await mkdtemp(cloneTempPrefix());

  try {
    await execFileAsync("git", ["clone", "--depth", "1", "--single-branch", repo.cloneUrl, rootPath], {
      timeout: cloneTimeoutMs(),
      maxBuffer: 1024 * 1024
    });
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(formatGitCloneError(error, repo));
  }

  return {
    repo,
    rootPath,
    cleanup: () => rm(rootPath, { recursive: true, force: true })
  };
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
