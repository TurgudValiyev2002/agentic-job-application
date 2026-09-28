import { z } from "zod";
import { enqueueApplication, ApplicationError } from "@/lib/job-applications/store";
import { applicantProfileSchema } from "@/lib/job-applications/types";
import { localRequestError } from "@/lib/job-applications/http";
const schema = z.object({ rewriteId: z.uuid(), profile: applicantProfileSchema, url: z.string().max(1000) }).strict();
export async function POST(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Enter your name, valid email, and a Lever application URL." }, { status: 400 });
  try { return Response.json({ id: await enqueueApplication(parsed.data.rewriteId, parsed.data.profile, parsed.data.url) }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not prepare application." }, { status: error instanceof ApplicationError ? error.status : 500 }); }
}
