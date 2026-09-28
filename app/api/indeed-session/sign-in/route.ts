import { localRequestError } from "@/lib/job-applications/http";
import { startIndeedSignIn } from "@/lib/indeed/sign-in";

export const runtime = "nodejs";

/** Opens a visible browser window on this computer; the person signs in there. Nothing is typed by the app. */
export async function POST(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  try {
    const result = startIndeedSignIn();
    return Response.json(result, { status: result.started ? 202 : 409, headers: { "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Could not open the sign-in window. Check the local browser installation." }, { status: 503 }); }
}
