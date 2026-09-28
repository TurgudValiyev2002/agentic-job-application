import { localRequestError } from "@/lib/job-applications/http";
import { checkSavedIndeedSession } from "@/lib/indeed/sign-in";

export const runtime = "nodejs";
export const maxDuration = 90;
let busy = false;
let lastCheck = 0;
export async function POST(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  if (busy || Date.now() - lastCheck < 60_000) return Response.json({ error: "Please wait a minute before checking the session again." }, { status: 429 });
  busy = true; lastCheck = Date.now();
  try { return Response.json(await checkSavedIndeedSession(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "Could not check the saved session. Check the local browser installation and encryption configuration." }, { status: 503 }); }
  finally { busy = false; }
}
