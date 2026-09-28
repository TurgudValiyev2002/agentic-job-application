import { localRequestError } from "@/lib/job-applications/http";
import { listModels, probeConnection, probeSchema } from "@/lib/ai/connection-probe";

/** The model ids the server lists, for the form's model field. */
export async function POST(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  const parsed = probeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter a full http(s) URL first." }, { status: 400 });
  try {
    return Response.json({ models: await listModels(await probeConnection(parsed.data)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: `Could not load models: ${error instanceof Error ? error.message : "unknown error"}` }, { status: 502 });
  }
}
