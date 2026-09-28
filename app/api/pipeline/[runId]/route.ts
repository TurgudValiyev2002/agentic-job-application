import { z } from "zod";
import { getPipelineRun } from "@/lib/pipeline/store";

export async function GET(_request: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;
  if (!z.uuid().safeParse(runId).success) return Response.json({ error: "Pipeline run not found." }, { status: 404 });
  const run = await getPipelineRun(runId);
  if (!run) return Response.json({ error: "Pipeline run not found." }, { status: 404 });
  return Response.json(run, { headers: { "Cache-Control": "no-store" } });
}
