import { localRequestError } from "@/lib/job-applications/http";
import { indeedHistoryView, syncIndeedHistory } from "@/lib/indeed/history";

export const runtime = "nodejs";
export const maxDuration = 120;
const state = globalThis as typeof globalThis & { orchHistorySync?: { busy: boolean; last: number } };
const sync = state.orchHistorySync ??= { busy: false, last: 0 };
export async function GET(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  return Response.json(await indeedHistoryView(), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  if (sync.busy || Date.now() - sync.last < 30_000) return Response.json({ error: "Please wait before syncing Indeed again." }, { status: 429 });
  sync.busy = true; sync.last = Date.now();
  try { return Response.json(await syncIndeedHistory(), { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not sync Indeed applications." }, { status: 503 }); }
  finally { sync.busy = false; }
}
