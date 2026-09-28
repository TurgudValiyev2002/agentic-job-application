import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { applications, db } from "@/lib/db";
import { localRequestError } from "@/lib/job-applications/http";
import { resolveRewriteProvider } from "@/lib/ai/cv-rewrite-request";
import { getSchedule, saveSchedule, scheduleInputSchema, setScheduleEnabled } from "@/lib/pipeline/schedule";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  return Response.json({ schedule: await getSchedule() }, { headers: noStore });
}

/** Saves the New run settings as the daily run and turns it on. */
export async function PUT(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  const parsed = scheduleInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose a profile, a model and your search preferences." }, { status: 400 });
  const [profile] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, parsed.data.profileId), isNull(applications.archivedAt))).limit(1);
  if (!profile) return Response.json({ error: "That profile no longer exists." }, { status: 404 });
  const selected = await resolveRewriteProvider(parsed.data.provider);
  if (!selected.ok) return Response.json({ error: selected.message }, { status: selected.status });
  await saveSchedule(parsed.data);
  return Response.json({ schedule: await getSchedule() }, { headers: noStore });
}

/** Turns the saved daily run on or off without forgetting its settings. */
export async function PATCH(request: Request) {
  const denied = localRequestError(request); if (denied) return denied;
  const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Provide enabled: true or false." }, { status: 400 });
  if (!await setScheduleEnabled(parsed.data.enabled)) return Response.json({ error: "Save a daily run first." }, { status: 404 });
  return Response.json({ schedule: await getSchedule() }, { headers: noStore });
}
