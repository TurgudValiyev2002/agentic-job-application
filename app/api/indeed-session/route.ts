import { localRequestError } from "@/lib/job-applications/http";
import { indeedSessionStatus, removeIndeedSession } from "@/lib/indeed/session";
import { signInProgress } from "@/lib/indeed/sign-in";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  try { return json({ ...(await indeedSessionStatus()), signIn: signInProgress() }); }
  catch { return json({ error: "Could not read the saved session. Check database and credential encryption configuration." }, 503); }
}

export async function DELETE(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  if (signInProgress().active) return json({ error: "Close the sign-in window before removing the saved session." }, 409);
  try { await removeIndeedSession(); return json({ saved: false, emailHint: null, verifiedAt: null, signIn: signInProgress() }); }
  catch { return json({ error: "Could not remove this session. Please retry." }, 503); }
}
