import { NextResponse } from "next/server";
import { z } from "zod";
import { saveAnalysis } from "@/lib/analysis-store";
import { buildAnalysisResult } from "@/lib/sample-data";

const AnalyzeSchema = z.object({
  repoUrl: z.string().url(),
  role: z.enum(["frontend", "backend", "fullstack", "infra", "qa", "opensource"]).default("backend")
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = AnalyzeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Valid repoUrl and role are required." }, { status: 400 });
  }

  const result = buildAnalysisResult(parsed.data.repoUrl, parsed.data.role);
  saveAnalysis(result);

  return NextResponse.json({
    jobId: result.jobId,
    status: "complete",
    graph: result.graph,
    tasks: result.tasks,
    familiarity: result.familiarity
  });
}
