import { listProfiles } from "@/lib/db/queries";
import { localRequestError } from "@/lib/job-applications/http";

export async function GET(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  return Response.json({ profiles: await listProfiles(new URL(request.url).searchParams.get("archived") === "1") }, { headers: { "Cache-Control": "no-store" } });
}
