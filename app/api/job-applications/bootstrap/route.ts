import { z } from "zod";
import { bootstrap, ApplicationError } from "@/lib/job-applications/store";
import { localRequestError } from "@/lib/job-applications/http";
export async function GET(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  const id = new URL(request.url).searchParams.get("rewrite");
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Select a tailored CV." }, { status: 400 });
  try { return Response.json(await bootstrap(id!)); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not load application." }, { status: error instanceof ApplicationError ? error.status : 500 }); }
}
