import { NextResponse } from "next/server";
import { z } from "zod";
import { askMentor } from "@/lib/gemini";
import { getAnalysis } from "@/lib/analysis-store";

const ChatSchema = z.object({
  jobId: z.string().min(1),
  nodeId: z.string().optional(),
  taskId: z.string().optional(),
  question: z.string().min(1)
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = ChatSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "jobId and question are required." }, { status: 400 });
  }

  const result = getAnalysis(parsed.data.jobId);
  if (!result) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const node = parsed.data.nodeId ? result.graph.nodes.find((item) => item.id === parsed.data.nodeId) : undefined;
  const task = parsed.data.taskId ? result.tasks.find((item) => item.id === parsed.data.taskId) : undefined;
  const context = JSON.stringify({ repo: result.graph.repo, node, task }, null, 2);
  const answer = await askMentor(parsed.data.question, context);

  return NextResponse.json({ answer });
}
