import { NextResponse } from "next/server";
import { getAnalysis } from "@/lib/analysis-store";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  const result = getAnalysis(jobId);

  if (!result) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({
    jobId,
    status: "complete",
    graph: result.graph,
    tasks: result.tasks,
    familiarity: result.familiarity
  });
}
