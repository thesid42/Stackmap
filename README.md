# StackMap

StackMap is an AI onboarding workspace for engineering teams. It turns a GitHub repo or microservice monorepo into an architecture map, source-backed onboarding missions, mentor chat, and codebase familiarity progress.

## Hackathon MVP

- Paste a public GitHub repo URL (or use the built-in demo URL)
- Select an onboarding role
- Async analysis: clone → index → specialist Gemini agents → architecture graph
- **Antigravity managed agent** (`interactions.create`, `environment: remote`) bootstraps a remote sandbox per repo; mentor chat continues the same session via `previous_interaction_id`
- Role-specific onboarding missions with file evidence
- Inspect services, files, evidence, and risks
- Ask the mentor agent about the selected node or task
- Mark tasks complete and update familiarity progress

## Architecture

```txt
GitHub repo URL
  → Repo Ingestion (shallow clone; reused from `.data/repo-cache` when present)
  → Code Indexer (monorepo service discovery, import hints)
  → Gemini Agent Orchestrator (7 specialist agents in parallel)
  → Architecture Graph Builder (merge + normalize)
  → Knowledge Graph (.data/jobs JSON + in-memory)
  → StackMap API + Dashboard
```

Specialist agents: Service Discovery, Structure, API, Data, Dependency, Risk, Task Workflow.

## Run

```bash
npm install
npm run dev
```

Create `.env.local`:

```bash
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemini-3.5-flash
# Antigravity managed agent (Interactions API + remote sandbox)
GEMINI_MANAGED_AGENT=antigravity-preview-05-2026
# Set to 0 to disable managed agents and use generateContent only
# STACKMAP_USE_MANAGED_AGENTS=0
# STACKMAP_USE_SAMPLE=1   # force demo graph for any URL
```

Requires `git` on PATH. Only public `github.com` repos are supported for live analysis. Re-analyzing the same repo reuses a shallow clone under `.data/repo-cache/` (override with `STACKMAP_REPO_CACHE_DIR`; optional `STACKMAP_CACHE_TTL_MS`).

**Demo mode:** URLs matching `example/stackmap-demo` load the rich sample microservices graph instantly (no clone).

## API

| Route | Method | Description |
|-------|--------|-------------|
| `/api/analyze` | POST | Start job `{ repoUrl, role }` → `{ jobId, status: "processing" }` |
| `/api/jobs/[jobId]` | GET | Poll job status, graph, tasks, familiarity |
| `/api/tasks` | POST | Update mission status |
| `/api/chat` | POST | Mentor chat (Managed Agent when session exists) |

## Key files

- `lib/analyzer.ts` — async job pipeline
- `lib/managed-agents.ts` — Gemini Interactions API (`antigravity-preview-05-2026`, remote sandbox)
- `lib/agent-orchestrator.ts` — parallel Gemini specialist agents (graph/missions)
- `lib/graph-builder.ts` — merge agent output + index fallbacks
- `lib/repo-indexer.ts` — monorepo services, import hints
- `lib/repo-scanner.ts` — clone + scan
- `lib/analysis-store.ts` — job persistence under `.data/jobs/`
- `app/page.tsx` — dashboard UI
