import { z } from "zod";
import { localRequestError } from "@/lib/job-applications/http";
import { getPipelineRun, stopRetrying } from "@/lib/pipeline/store";

/** Ends a run that is waiting for its next automatic retry. */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  const denied = localRequestError(request); if (denied) return denied;
  const { runId } = await context.params;
  if (!z.uuid().safeParse(runId).success) return Response.json({ error: "Pipeline run not found." }, { status: 404 });
  if (!await stopRetrying(runId)) return Response.json({ error: "This run is not waiting to retry." }, { status: 409 });
  return Response.json(await getPipelineRun(runId), { headers: { "Cache-Control": "no-store" } });
}
