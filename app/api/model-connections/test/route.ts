import { localRequestError } from "@/lib/job-applications/http";
import { probeConnection, probeSchema, testConnection } from "@/lib/ai/connection-probe";

/** Tries a connection as typed in the form, with one tiny structured request (and embeddings, if set). */
export async function POST(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  const parsed = probeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !parsed.data.model) return Response.json({ error: "Enter a URL and a model first." }, { status: 400 });
  return Response.json(await testConnection(await probeConnection(parsed.data)), { headers: { "Cache-Control": "no-store" } });
}
