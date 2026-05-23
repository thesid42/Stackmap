import { NextResponse } from "next/server";
import { z } from "zod";
import { updateTaskStatus } from "@/lib/analysis-store";

export const runtime = "nodejs";

const TaskStatusSchema = z.object({
  jobId: z.string().min(1),
  taskId: z.string().min(1),
  status: z.enum(["todo", "in_progress", "done", "blocked"])
});

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = TaskStatusSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "jobId, taskId, and valid status are required." }, { status: 400 });
  }

  const result = await updateTaskStatus(parsed.data.jobId, parsed.data.taskId, parsed.data.status);
  if (!result) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({
    tasks: result.tasks,
    familiarity: result.familiarity
  });
}
