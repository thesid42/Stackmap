import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, open, readdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { classifyFile, detectLanguage, shouldIndexFile, type IndexedFile } from "@/lib/repo-indexer";
import { getScanLimits, type ScanLimits } from "@/lib/scan-limits";

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

const cloneLockFile = "cloning.lock";
const defaultLockWaitMs = 600_000;

function repoCacheRoot() {
  const override = process.env.STACKMAP_REPO_CACHE_DIR;
  if (override) return path.resolve(override);
  return path.join(process.cwd(), ".data", "repo-cache");
}

function cacheTtlMs(): number | null {
  const raw = process.env.STACKMAP_CACHE_TTL_MS;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function repoCacheKey(repo: Pick<RepoIdentity, "owner" | "name">) {
  return `${repo.owner}-${repo.name}`;
}

export function repoCachePath(repo: Pick<RepoIdentity, "owner" | "name">) {
  return path.join(repoCacheRoot(), repoCacheKey(repo));
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isValidCache(cachePath: string) {
  try {
    await access(path.join(cachePath, ".git"));
  } catch {
    return false;
  }

  const ttl = cacheTtlMs();
  if (ttl === null) return true;

  const gitStat = await stat(path.join(cachePath, ".git"));
  return Date.now() - gitStat.mtimeMs < ttl;
}

/** Whether a fresh shallow clone is needed (missing, incomplete, or past TTL). */
export async function isRepositoryCached(repoUrl: string) {
  const repo = parseGitHubRepoUrl(repoUrl);
  return isValidCache(repoCachePath(repo));
}

export type RepoScanLimits = ScanLimits;

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
  walkedFileCount: number;
  limits: ScanLimits;
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

async function gitShallowClone(repo: RepoIdentity, targetPath: string) {
  await execFileAsync("git", ["clone", "--depth", "1", "--single-branch", repo.cloneUrl, targetPath], {
    timeout: cloneTimeoutMs(),
    maxBuffer: 1024 * 1024
  });
}

async function populateCache(repo: RepoIdentity, cachePath: string) {
  await mkdir(repoCacheRoot(), { recursive: true });
  const stagingParent = path.dirname(cachePath);
  const stagingPath = await mkdtemp(path.join(stagingParent, `.${repoCacheKey(repo)}-`));

  try {
    await gitShallowClone(repo, stagingPath);
    await rm(cachePath, { recursive: true, force: true }).catch(() => undefined);
    await rename(stagingPath, cachePath);
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => undefined);
    throw new Error(formatGitCloneError(error, repo));
  }
}

async function ensureRepositoryCached(repo: RepoIdentity) {
  const cachePath = repoCachePath(repo);
  const lockPath = path.join(cachePath, cloneLockFile);
  const deadline = Date.now() + defaultLockWaitMs;

  while (Date.now() < deadline) {
    if (await isValidCache(cachePath)) {
      return { rootPath: cachePath, fromCache: true };
    }

    await mkdir(repoCacheRoot(), { recursive: true });
    await mkdir(cachePath, { recursive: true });

    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n${Date.now()}`);
      await handle.close();

      try {
        if (await isValidCache(cachePath)) {
          return { rootPath: cachePath, fromCache: true };
        }
        await populateCache(repo, cachePath);
        return { rootPath: cachePath, fromCache: false };
      } finally {
        await rm(lockPath, { force: true }).catch(() => undefined);
      }
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code !== "EEXIST") throw error;
      await sleep(500);
    }
  }

  throw new Error(
    `Timed out waiting to prepare cached clone for ${repo.displayUrl}. Another analysis may still be cloning this repository.`
  );
}

export async function cloneRepository(repoUrl: string) {
  const repo = parseGitHubRepoUrl(repoUrl);
  const { rootPath, fromCache } = await ensureRepositoryCached(repo);

  return {
    repo,
    rootPath,
    fromCache,
    /** Persistent cache is retained; no-op for API compatibility. */
    cleanup: async () => undefined
  };
}

export async function scanRepository(repo: RepoIdentity, rootPath: string): Promise<RepoScan> {
  const walked = await walkFiles(rootPath);
  const limits = getScanLimits(walked.length);

  const indexed = walked
    .filter((file) => shouldIndexFile(file.relativePath))
    .filter((file) => file.size <= limits.maxFileBytes)
    .filter((file) => !binaryExtensions.has(path.extname(file.relativePath).toLowerCase()))
    .slice(0, limits.maxIndexedFiles)
    .map((file) => ({
      path: file.relativePath,
      language: detectLanguage(file.relativePath),
      size: file.size,
      kind: classifyFile(file.relativePath)
    }));

  const snippets = await collectSnippets(rootPath, indexed, limits);
  const packageJson = snippets.find((snippet) => snippet.path === "package.json")?.content;

  return {
    repo,
    rootPath,
    files: indexed,
    fileTree: limits.compactTree ? buildCompactFileTree(indexed) : buildFileTree(indexed, limits),
    snippets,
    language: detectPrimaryLanguage(indexed),
    framework: detectFramework(indexed, packageJson),
    sourceType: detectSourceType(indexed, packageJson),
    walkedFileCount: walked.length,
    limits
  };
}

async function walkFiles(
  rootPath: string,
  currentPath = rootPath,
  walkedCount = { n: 0 },
  maxWalkFiles = getScanLimits(0).maxWalkFiles
): Promise<{ fullPath: string; relativePath: string; size: number }[]> {
  if (walkedCount.n >= maxWalkFiles) return [];

  const entries = await readdir(currentPath, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      if (walkedCount.n >= maxWalkFiles) return [];

      const fullPath = path.join(currentPath, entry.name);
      const relativePath = toRepoPath(path.relative(rootPath, fullPath));

      if (entry.isDirectory()) {
        if (!shouldIndexFile(relativePath)) return [];
        return walkFiles(rootPath, fullPath, walkedCount, maxWalkFiles);
      }

      if (!entry.isFile()) return [];
      walkedCount.n += 1;
      const info = await stat(fullPath);
      return [{ fullPath, relativePath, size: info.size }];
    })
  );

  return results.flat();
}

async function collectSnippets(rootPath: string, files: IndexedFile[], limits: ScanLimits) {
  const ranked = [...files].sort((a, b) => scoreFile(b) - scoreFile(a)).slice(0, limits.maxSnippetFiles);
  const snippets: RepoSnippet[] = [];
  let totalChars = 0;

  for (const file of ranked) {
    if (totalChars >= limits.maxPromptChars) break;
    const fullPath = path.join(rootPath, file.path);
    const content = await readFile(fullPath, "utf8").catch(() => "");
    if (!content.trim()) continue;

    const clipped = content.slice(0, limits.maxSnippetChars);
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

function buildFileTree(files: IndexedFile[], limits: ScanLimits) {
  return files
    .slice(0, limits.maxIndexedFiles)
    .map((file) => `${file.path} (${file.kind}, ${file.language}, ${file.size} bytes)`)
    .join("\n");
}

function buildCompactFileTree(files: IndexedFile[]) {
  const byRoot = new Map<string, { count: number; kinds: Set<string> }>();
  for (const file of files) {
    const root = file.path.split("/")[0] ?? file.path;
    const bucket = byRoot.get(root) ?? { count: 0, kinds: new Set<string>() };
    bucket.count += 1;
    bucket.kinds.add(file.kind);
    byRoot.set(root, bucket);
  }

  return [...byRoot.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 48)
    .map(([dir, meta]) => `${dir}/ (${meta.count} files, kinds: ${[...meta.kinds].join(", ")})`)
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
