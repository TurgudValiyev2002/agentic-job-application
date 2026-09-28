import { z } from "zod";
import { localRequestError } from "@/lib/job-applications/http";
import { ConnectionError, connectionInputSchema, deleteConnection, saveConnection, withoutSecret } from "@/lib/ai/connections";

type Context = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: Context) {
  const denied = localRequestError(request); if (denied) return denied;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Connection not found." }, { status: 404 });
  const parsed = connectionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the connection fields." }, { status: 400 });
  try {
    return Response.json({ connection: withoutSecret(await saveConnection(parsed.data, id)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ConnectionError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && /encryption is not configured/.test(error.message)) return Response.json({ error: "Saving an API key needs ACCOUNT_CREDENTIALS_KEY in .env.local (generate one with: openssl rand -base64 32)." }, { status: 409 });
    throw error;
  }
}

export async function DELETE(request: Request, context: Context) {
  const denied = localRequestError(request, "application/json"); if (denied) return denied;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success || !await deleteConnection(id)) return Response.json({ error: "Connection not found." }, { status: 404 });
  return new Response(null, { status: 204 });
}
