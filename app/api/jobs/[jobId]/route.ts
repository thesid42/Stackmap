import { NextResponse } from "next/server";
import { getJob, jobToResponse } from "@/lib/analysis-store";

export const runtime = "nodejs";

type Params = {
  params: Promise<{ jobId: string }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { jobId } = await params;
  const job = await getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json(jobToResponse(job));
}
