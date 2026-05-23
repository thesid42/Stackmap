# StackMap

StackMap is an AI onboarding workspace for engineering teams. It turns a GitHub repo or microservice monorepo into an architecture map, source-backed onboarding missions, mentor chat, and codebase familiarity progress.

## Hackathon MVP

- Paste a public GitHub repo URL
- Select an onboarding role
- Generate a repo/platform map
- Create role-specific onboarding missions
- Inspect services, files, evidence, and risks
- Ask the mentor agent about the selected node or task
- Mark tasks complete and update familiarity progress

## Architecture

```txt
GitHub repo URL
  -> Repo Ingestion Service
  -> Code Indexer
  -> Gemini Managed Agent Orchestrator
  -> Architecture Graph Builder
  -> Task Workflow Agent
  -> StackMap Dashboard
```

## Current Skeleton

The app currently uses realistic sample data so the product flow is demoable before real ingestion is wired. Replace `app/api/analyze/route.ts` with GitHub fetching, indexing, and Gemini agent execution.

Important files:

- `app/page.tsx` - main dashboard UI
- `app/api/analyze/route.ts` - analysis endpoint
- `app/api/chat/route.ts` - mentor chat endpoint
- `app/api/tasks/route.ts` - task progress endpoint
- `lib/types.ts` - core graph and onboarding task types
- `lib/sample-data.ts` - demo graph and task output
- `lib/repo-indexer.ts` - file classification helpers
- `lib/agent-orchestrator.ts` - Gemini agent prompt plan

## Run

```bash
npm install
npm run dev
```

Create `.env.local` when Gemini credentials are available:

```bash
GEMINI_API_KEY=your_key_here
```
