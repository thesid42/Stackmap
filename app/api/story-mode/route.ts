import { NextResponse } from "next/server";
import { z } from "zod";
import { getAnalysis } from "@/lib/analysis-store";
import { createStoryModeBrief } from "@/lib/story-mode";

export const runtime = "nodejs";
export const maxDuration = 120;

const StoryModeSchema = z.object({
  jobId: z.string().min(1),
  nodeId: z.string().optional(),
  taskId: z.string().optional(),
  generateVideo: z.boolean().default(false)
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = StoryModeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "jobId and valid Story Mode options are required." }, { status: 400 });
  }

  const analysis = await getAnalysis(parsed.data.jobId);
  if (!analysis) {
    return NextResponse.json({ error: "Job not found or still processing." }, { status: 404 });
  }

  const node = parsed.data.nodeId
    ? analysis.graph.nodes.find((item) => item.id === parsed.data.nodeId)
    : analysis.graph.nodes[0];
  const task = parsed.data.taskId
    ? analysis.tasks.find((item) => item.id === parsed.data.taskId)
    : analysis.tasks[0];

  const brief = await createStoryModeBrief({
    graph: analysis.graph,
    node,
    task,
    generateVideo: parsed.data.generateVideo
  });

  return NextResponse.json({ brief });
}
