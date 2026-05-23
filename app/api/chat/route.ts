import { NextResponse } from "next/server";
import { z } from "zod";
import { getAnalysis } from "@/lib/analysis-store";
import { askMentor } from "@/lib/gemini";

export const runtime = "nodejs";

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

  const result = await getAnalysis(parsed.data.jobId);
  if (!result) {
    return NextResponse.json({ error: "Job not found or still processing." }, { status: 404 });
  }

  const node = parsed.data.nodeId ? result.graph.nodes.find((item) => item.id === parsed.data.nodeId) : undefined;
  const task = parsed.data.taskId ? result.tasks.find((item) => item.id === parsed.data.taskId) : undefined;

  const context = JSON.stringify(
    {
      repo: result.graph.repo,
      node,
      task,
      relatedNodes: task?.relatedNodeIds?.map((id) => result.graph.nodes.find((n) => n.id === id)).filter(Boolean),
      graphSummary: {
        nodeCount: result.graph.nodes.length,
        edgeCount: result.graph.edges.length,
        nodeTypes: [...new Set(result.graph.nodes.map((n) => n.type))]
      }
    },
    null,
    2
  );

  const answer = await askMentor(parsed.data.question, context);

  return NextResponse.json({ answer });
}
