import type { AnalysisResult, EngineerRole, OnboardingTask, StackMapGraph } from "@/lib/types";

export const sampleGraph: StackMapGraph = {
  repo: {
    name: "stackmap-demo-platform",
    url: "https://github.com/example/stackmap-demo-platform",
    sourceType: "monorepo",
    language: "TypeScript",
    framework: "Next.js + Node services"
  },
  nodes: [
    {
      id: "web",
      label: "Web App",
      type: "service",
      summary: "Customer-facing app that starts signup, login, and checkout flows.",
      files: ["apps/web/app/signup/page.tsx", "apps/web/lib/api.ts"],
      evidence: [{ file: "apps/web/lib/api.ts", reason: "API client calls auth and billing services." }],
      suggestedQuestions: ["Where does signup start?", "Which APIs does the web app call?"]
    },
    {
      id: "auth",
      label: "Auth Service",
      type: "service",
      summary: "Owns user identity, login, signup, sessions, and auth middleware.",
      files: ["services/auth/src/routes.ts", "services/auth/src/session.ts"],
      evidence: [{ file: "services/auth/src/routes.ts", reason: "Defines login and signup endpoints." }],
      risks: ["Auth flow has no integration test in this demo graph."],
      suggestedQuestions: ["How does login work?", "Where is session state created?"]
    },
    {
      id: "users-db",
      label: "Users DB",
      type: "data",
      summary: "Stores users, sessions, and profile fields owned by auth-service.",
      files: ["services/auth/prisma/schema.prisma"],
      evidence: [{ file: "services/auth/prisma/schema.prisma", reason: "Declares User and Session models." }]
    },
    {
      id: "billing",
      label: "Billing Service",
      type: "service",
      summary: "Handles checkout, payment webhooks, invoice creation, and billing events.",
      files: ["services/billing/src/routes.ts", "services/billing/src/webhooks.ts"],
      evidence: [{ file: "services/billing/src/webhooks.ts", reason: "Processes payment events." }],
      risks: ["Webhook idempotency should be verified before production use."]
    },
    {
      id: "queue",
      label: "Event Queue",
      type: "shared_library",
      summary: "Carries user.created and invoice.created events between services.",
      files: ["packages/events/src/topics.ts"],
      evidence: [{ file: "packages/events/src/topics.ts", reason: "Defines shared event topic names." }]
    },
    {
      id: "notify",
      label: "Notification Service",
      type: "service",
      summary: "Consumes events and sends onboarding, billing, and account emails.",
      files: ["services/notification/src/worker.ts"],
      evidence: [{ file: "services/notification/src/worker.ts", reason: "Consumes event queue messages." }]
    },
    {
      id: "risk-tests",
      label: "Testing Gap",
      type: "risk",
      summary: "Core auth and billing paths need integration coverage before larger changes.",
      files: ["services/auth/tests", "services/billing/tests"],
      evidence: [{ file: "services/auth/tests", reason: "No integration test detected in demo sample." }]
    }
  ],
  edges: [
    { id: "web-auth", source: "web", target: "auth", label: "login/signup", type: "calls" },
    { id: "auth-db", source: "auth", target: "users-db", label: "owns", type: "writes" },
    { id: "web-billing", source: "web", target: "billing", label: "checkout", type: "calls" },
    { id: "auth-queue", source: "auth", target: "queue", label: "user.created", type: "publishes" },
    { id: "billing-queue", source: "billing", target: "queue", label: "invoice.created", type: "publishes" },
    { id: "queue-notify", source: "queue", target: "notify", label: "email jobs", type: "routes_to" },
    { id: "auth-risk", source: "auth", target: "risk-tests", label: "missing tests", type: "depends_on" },
    { id: "billing-risk", source: "billing", target: "risk-tests", label: "missing tests", type: "depends_on" }
  ]
};

export function buildTasks(role: EngineerRole): OnboardingTask[] {
  const base: OnboardingTask[] = [
    {
      id: "task-map",
      title: "Read the platform map",
      difficulty: "easy",
      area: "architecture",
      description: "Identify each service, what it owns, and the first two cross-service flows.",
      filesToRead: ["README.md", "infra/docker-compose.yml"],
      successCriteria: ["Name the services", "Explain the signup and checkout paths"],
      estimatedMinutes: 15,
      relatedNodeIds: ["web", "auth", "billing", "notify"],
      status: "todo"
    },
    {
      id: "task-login",
      title: "Trace login from UI to session",
      difficulty: "medium",
      area: "backend",
      description: "Follow the login request from the web app into the auth service and session creation.",
      filesToRead: ["apps/web/app/login/page.tsx", "services/auth/src/routes.ts", "services/auth/src/session.ts"],
      successCriteria: ["Find the endpoint", "Explain where session state is created", "List one edge case"],
      estimatedMinutes: 25,
      relatedNodeIds: ["web", "auth", "users-db"],
      status: "todo"
    },
    {
      id: "task-first-pr",
      title: "Make a safe first contribution",
      difficulty: "medium",
      area: role === "frontend" ? "frontend" : "testing",
      description: "Add a small logging, copy, validation, or test improvement tied to the login flow.",
      filesToRead: ["services/auth/src/routes.ts", "services/auth/tests/login.test.ts"],
      successCriteria: ["Change is scoped", "Behavior is explained", "A test or manual check is listed"],
      estimatedMinutes: 35,
      relatedNodeIds: ["auth", "risk-tests"],
      status: "todo"
    },
    {
      id: "task-events",
      title: "Understand event-driven emails",
      difficulty: "hard",
      area: "architecture",
      description: "Trace how user.created and invoice.created events reach the notification worker.",
      filesToRead: ["packages/events/src/topics.ts", "services/notification/src/worker.ts"],
      successCriteria: ["Identify event producers", "Identify the consumer", "Explain a retry risk"],
      estimatedMinutes: 40,
      relatedNodeIds: ["auth", "billing", "queue", "notify"],
      status: "todo"
    }
  ];

  return base;
}

export function buildAnalysisResult(repoUrl: string, role: EngineerRole = "backend"): AnalysisResult {
  return {
    jobId: crypto.randomUUID(),
    graph: {
      ...sampleGraph,
      repo: {
        ...sampleGraph.repo,
        url: repoUrl || sampleGraph.repo.url
      }
    },
    tasks: buildTasks(role),
    familiarity: {
      overall: 18,
      areas: {
        architecture: 25,
        frontend: role === "frontend" ? 30 : 10,
        backend: role === "backend" ? 30 : 18,
        data: 12,
        testing: 8,
        infra: 10,
        riskAwareness: 15
      },
      suggestedNextStep: "Start by tracing login from UI to session creation."
    }
  };
}
