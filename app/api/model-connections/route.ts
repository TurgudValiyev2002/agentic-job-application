import { localRequestError } from "@/lib/job-applications/http";
import { ConnectionError, connectionInputSchema, envConnections, saveConnection, savedConnections, withoutSecret } from "@/lib/ai/connections";
import { defaultAiProviderName } from "@/lib/ai/provider";

const noStore = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  const saved = await savedConnections();
  let envDefault = "lmstudio";
  try { envDefault = defaultAiProviderName(); } catch { /* An invalid AI_PROVIDER is reported by the pickers. */ }
  return Response.json({ connections: saved.map(withoutSecret), env: envConnections().map(withoutSecret), envDefault }, { headers: noStore });
}

export async function POST(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  const parsed = connectionInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Check the connection fields." }, { status: 400 });
  try {
    return Response.json({ connection: withoutSecret(await saveConnection(parsed.data)) }, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof ConnectionError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && /encryption is not configured/.test(error.message)) return Response.json({ error: "Saving an API key needs ACCOUNT_CREDENTIALS_KEY in .env.local (generate one with: openssl rand -base64 32)." }, { status: 409 });
    throw error;
  }
}
