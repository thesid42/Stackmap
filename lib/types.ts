export type SourceType = "single_repo" | "monorepo" | "multi_repo";

export type GraphNodeType =
  | "service"
  | "entry"
  | "api"
  | "component"
  | "data"
  | "config"
  | "test"
  | "risk"
  | "shared_library";

export type GraphEdgeType = "imports" | "calls" | "reads" | "writes" | "routes_to" | "depends_on" | "publishes";

export type Evidence = {
  file: string;
  lines?: [number, number];
  reason: string;
};

export type StackMapNode = {
  id: string;
  label: string;
  type: GraphNodeType;
  summary: string;
  files: string[];
  evidence: Evidence[];
  risks?: string[];
  suggestedQuestions?: string[];
};

export type StackMapEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: GraphEdgeType;
};

export type StackMapGraph = {
  repo: {
    name: string;
    url: string;
    sourceType: SourceType;
    language: string;
    framework?: string;
  };
  nodes: StackMapNode[];
  edges: StackMapEdge[];
};

export type EngineerRole = "frontend" | "backend" | "fullstack" | "infra" | "qa" | "opensource";

export type OnboardingTask = {
  id: string;
  /** Week-1 path order (1 = first mission). */
  order?: number;
  title: string;
  difficulty: "easy" | "medium" | "hard";
  area: "architecture" | "frontend" | "backend" | "api" | "data" | "testing" | "infra" | "risk";
  description: string;
  filesToRead: string[];
  successCriteria: string[];
  estimatedMinutes: number;
  relatedNodeIds: string[];
  status: "todo" | "in_progress" | "done" | "blocked";
};

export type FamiliarityScore = {
  overall: number;
  areas: Record<"architecture" | "frontend" | "backend" | "data" | "testing" | "infra" | "riskAwareness", number>;
  suggestedNextStep: string;
};

export type AnalysisResult = {
  jobId: string;
  graph: StackMapGraph;
  tasks: OnboardingTask[];
  familiarity: FamiliarityScore;
  managedAgent?: ManagedAgentSession;
};

export type ManagedAgentSession = {
  agent: string;
  interactionId: string;
  environmentId?: string;
  stepCount?: number;
  bootstrappedAt?: string;
};

export type StoryModeScene = {
  id: string;
  title: string;
  durationSeconds: number;
  narration: string;
  aiVisualPrompt: string;
  overlayTitle: string;
  overlayFacts: string[];
  files: string[];
  highlightedNodeIds: string[];
};

export type StoryModeBrief = {
  id: string;
  title: string;
  status: "storyboard" | "generating_video" | "complete" | "failed";
  durationSeconds: number;
  narrationScript: string;
  scenes: StoryModeScene[];
  audioUrl?: string;
  error?: string;
};
