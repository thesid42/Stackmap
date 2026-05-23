import { NextResponse } from "next/server";
import { z } from "zod";
import { startAnalysisJob } from "@/lib/analyzer";

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
    const { jobId } = await startAnalysisJob(parsed.data.repoUrl, parsed.data.role);

    return NextResponse.json({
      jobId,
      status: "processing"
    });
  } catch (error) {
    console.error("Failed to start analysis job.", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not start analysis."
      },
      { status: 500 }
    );
  }
}
