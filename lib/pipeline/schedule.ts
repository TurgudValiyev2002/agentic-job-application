import "server-only";

import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { applications, db, pipelineRuns, pipelineSchedules } from "@/lib/db";
import { resolveRewriteProvider } from "@/lib/ai/cv-rewrite-request";
import { loadIndeedSession } from "@/lib/indeed/session";
import { workerActive } from "@/lib/job-applications/store";
import { searchPreferencesSchema } from "../jobs/preferences";
import { maxMatchesSchema } from "./options";
import { enqueuePipeline, PipelineRequestError } from "./store";
import { providerIdSchema } from "@/lib/ai/connection-kinds";

const SCHEDULE_ID = "daily";
export const SCHEDULE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const scheduleInputSchema = z.object({
  profileId: z.uuid(),
  provider: providerIdSchema,
  preferences: searchPreferencesSchema,
  autoApply: z.boolean(),
  maxMatches: maxMatchesSchema,
}).strict();
export type ScheduleInput = z.infer<typeof scheduleInputSchema>;

export type ScheduleView = ScheduleInput & {
  enabled: boolean;
  profileName: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  /** When the worker will next start a run; null while turned off. Past means "as soon as the worker checks". */
  nextRunAt: string | null;
  lastMessage: string | null;
};

export async function getSchedule(): Promise<ScheduleView | null> {
  const [row] = await db.select({ schedule: pipelineSchedules, profileName: applications.name })
    .from(pipelineSchedules).leftJoin(applications, eq(applications.id, pipelineSchedules.profileId))
    .where(eq(pipelineSchedules.id, SCHEDULE_ID)).limit(1);
  if (!row) return null;
  const { schedule } = row;
  const preferences = searchPreferencesSchema.safeParse(schedule.preferences);
  return {
    enabled: schedule.enabled, profileId: schedule.profileId ?? "", profileName: row.profileName,
    provider: schedule.provider as ScheduleInput["provider"], preferences: preferences.success ? preferences.data : searchPreferencesSchema.parse({}),
    autoApply: schedule.autoApply, maxMatches: schedule.maxMatches,
    lastRunAt: schedule.lastRunAt?.toISOString() ?? null, lastRunId: schedule.lastRunId,
    nextRunAt: schedule.enabled ? new Date(schedule.lastRunAt ? schedule.lastRunAt.getTime() + SCHEDULE_INTERVAL_MS : Date.now()).toISOString() : null,
    lastMessage: schedule.lastMessage,
  };
}

/** Saves the daily run's settings and turns it on. A new schedule runs straight away; an edit keeps its rhythm. */
export async function saveSchedule(input: ScheduleInput) {
  const values = { ...input, enabled: true, lastMessage: null, updatedAt: new Date() };
  await db.insert(pipelineSchedules).values({ id: SCHEDULE_ID, ...values })
    .onConflictDoUpdate({ target: pipelineSchedules.id, set: values });
}

export async function setScheduleEnabled(enabled: boolean) {
  const rows = await db.update(pipelineSchedules).set({ enabled, lastMessage: null, updatedAt: new Date() })
    .where(eq(pipelineSchedules.id, SCHEDULE_ID)).returning({ id: pipelineSchedules.id });
  return rows.length > 0;
}

/** Why the saved daily run cannot start right now, or null when it can. */
async function blockedReason(schedule: typeof pipelineSchedules.$inferSelect) {
  if (!schedule.profileId) return { message: "The saved profile was deleted. Save the daily run again with another profile." };
  const [profile] = await db.select().from(applications).where(and(eq(applications.id, schedule.profileId), isNull(applications.archivedAt))).limit(1);
  if (!profile) return { message: "The saved profile is archived. Save the daily run again with another profile." };
  if (profile.cvStatus !== "ready" || !profile.cvDocumentId) return { message: `${profile.name} is not ready (its CV is ${profile.cvStatus}). The daily run starts once it is.` };
  const selected = await resolveRewriteProvider(schedule.provider as ScheduleInput["provider"]);
  if (!selected.ok) return { message: `The saved model is unavailable: ${selected.message}` };
  if (schedule.autoApply) {
    if (!await loadIndeedSession()) return { message: "Sign in to Indeed so the daily run can save drafts." };
    if (!await workerActive()) return { message: "The applications worker is not running, so the daily run cannot save drafts." };
  }
  return { profile, provider: selected.provider };
}

/**
 * Called by the pipeline worker about once a minute: starts the saved daily run when it is on, 24 hours have
 * passed since the last one, and no run is queued or running. The row lock keeps several workers from starting
 * it twice. Returns the new run's id, if one was started.
 */
export async function startDueScheduledRun() {
  return db.transaction(async (tx) => {
    const [schedule] = await tx.select().from(pipelineSchedules).where(eq(pipelineSchedules.id, SCHEDULE_ID))
      .limit(1).for("update", { skipLocked: true });
    if (!schedule?.enabled) return null;
    if (schedule.lastRunAt && Date.now() - schedule.lastRunAt.getTime() < SCHEDULE_INTERVAL_MS) return null;
    // A run already in progress (or waiting to retry) finishes first; the daily run follows it.
    const [active] = await tx.select({ id: pipelineRuns.id }).from(pipelineRuns).where(inArray(pipelineRuns.status, ["queued", "running"])).limit(1);
    if (active) return null;
    const note = async (message: string) => {
      if (message !== schedule.lastMessage) await tx.update(pipelineSchedules).set({ lastMessage: message, updatedAt: new Date() }).where(eq(pipelineSchedules.id, SCHEDULE_ID));
      return null;
    };
    const ready = await blockedReason(schedule);
    if ("message" in ready) return note(ready.message!);
    try {
      const preferences = searchPreferencesSchema.parse(schedule.preferences);
      const run = await enqueuePipeline(ready.profile.cvDocumentId!, ready.provider, randomUUID(), preferences, schedule.autoApply, schedule.maxMatches, ready.profile.id, { scheduled: true });
      await tx.update(pipelineSchedules).set({ lastRunAt: new Date(), lastRunId: run.id, lastMessage: null, updatedAt: new Date() }).where(eq(pipelineSchedules.id, SCHEDULE_ID));
      return run.id;
    } catch (error) {
      if (error instanceof PipelineRequestError || error instanceof z.ZodError) return note(`The daily run could not start: ${error.message}`);
      throw error;
    }
  });
}
