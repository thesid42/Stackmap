import { NextResponse } from "next/server";
import { z } from "zod";
import { analyzeRepository } from "@/lib/analyzer";
import { saveAnalysis } from "@/lib/analysis-store";

export const runtime = "nodejs";

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

  try {
    const result = await analyzeRepository(parsed.data.repoUrl, parsed.data.role);
    saveAnalysis(result);

    return NextResponse.json({
      jobId: result.jobId,
      status: "complete",
      graph: result.graph,
      tasks: result.tasks,
      familiarity: result.familiarity
    });
  } catch (error) {
    console.error("Repository analysis failed.", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not analyze the repository. Check that it is a public GitHub repo."
      },
      { status: 500 }
    );
  }
}
