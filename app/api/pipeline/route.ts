import { searchPreferencesSchema } from "@/lib/jobs/preferences";
import { localRequestError } from "@/lib/job-applications/http";
import { loadIndeedSession } from "@/lib/indeed/session";
import { workerActive } from "@/lib/job-applications/store";
import { z } from "zod";
import { maxMatchesSchema } from "@/lib/pipeline/options";
import { resolveRewriteProvider } from "@/lib/ai/cv-rewrite-request";
import { selectCvDocument } from "@/lib/cv/saved-document";
import { enqueuePipeline, getPipelineRun, PipelineRequestError, recentPipelineRuns } from "@/lib/pipeline/store";
import { providerIdSchema } from "@/lib/ai/connection-kinds";

const requestSchema = z.object({
  cvDocumentId: z.uuid(),
  profileId: z.uuid().optional(),
  requestId: z.uuid(),
  preferences: searchPreferencesSchema.optional(),
  autoApply: z.boolean().default(false),
  maxMatches: maxMatchesSchema,
  provider: providerIdSchema.optional(),
}).strict();

// Same local, single-user boundary as the existing CV and Jobs endpoints.
export async function POST(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Provide cvDocumentId, a unique requestId, and an optional supported provider." }, { status: 400 });
  const selected = await resolveRewriteProvider(parsed.data.provider);
  if (!selected.ok) return Response.json({ error: selected.message }, { status: selected.status });
  try {
    if (parsed.data.autoApply) {
      if (!await loadIndeedSession()) return Response.json({ error: "Sign in to Indeed before saving drafts." }, { status: 409 });
      if (!await workerActive()) return Response.json({ error: "Start the applications worker before saving drafts." }, { status: 409 });
    }
    const run = await enqueuePipeline(parsed.data.cvDocumentId, selected.provider, parsed.data.requestId, parsed.data.preferences, parsed.data.autoApply, parsed.data.maxMatches, parsed.data.profileId);
    // Remember this CV so the next run starts with it preselected.
    await selectCvDocument(run.cvDocumentId);
    return Response.json(await getPipelineRun(run.id), {
      status: 202, headers: { Location: `/api/pipeline/${run.id}`, "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof PipelineRequestError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Failed to queue pipeline", error);
    return Response.json({ error: "The pipeline could not be queued. Check the database connection and migrations." }, { status: 503 });
  }
}

export async function GET() {
  return Response.json({ runs: await recentPipelineRuns() }, { headers: { "Cache-Control": "no-store" } });
}
