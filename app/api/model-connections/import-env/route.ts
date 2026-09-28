import { localRequestError } from "@/lib/job-applications/http";
import { importEnvConnections, savedConnections, withoutSecret } from "@/lib/ai/connections";
import { defaultAiProviderName } from "@/lib/ai/provider";

/** Turns the .env.local providers into saved, editable connections (once, while none are saved). */
export async function POST(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  if ((await savedConnections()).length) return Response.json({ error: "Connections are already saved; add more with the form." }, { status: 409 });
  try {
    const imported = await importEnvConnections(defaultAiProviderName());
    return Response.json({ connections: imported.map(withoutSecret) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && /encryption is not configured/.test(error.message)) return Response.json({ error: "Importing the OpenRouter key needs ACCOUNT_CREDENTIALS_KEY in .env.local." }, { status: 409 });
    throw error;
  }
}
