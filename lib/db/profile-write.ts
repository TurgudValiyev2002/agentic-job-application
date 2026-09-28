import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { applications, db } from "./index";

export class ProfileError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export async function changeProfile(id: string, action: "select" | "retry" | "archive") {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(74819302)`);
    const [profile] = await tx.select().from(applications).where(and(eq(applications.id, id), isNull(applications.archivedAt))).for("update");
    if (!profile) throw new ProfileError("Profile not found.", 404);
    if (action === "select" && (profile.cvStatus !== "ready" || !profile.cvDocumentId)) throw new ProfileError("Choose a ready profile.");
    const [selected] = await tx.select({ id: applications.id }).from(applications).where(isNull(applications.archivedAt))
      .orderBy(sql`${applications.selectedAt} desc nulls last`, desc(applications.createdAt)).limit(1);
    if (action === "archive" && selected?.id === id) throw new ProfileError("Select another profile before archiving this one.");
    const [updated] = await tx.update(applications).set({ updatedAt: new Date(), ...(action === "select"
      ? { selectedAt: new Date() } : action === "archive"
      ? { archivedAt: new Date(), jobStartedAt: null }
      : { cvStatus: "generating" as const, cvError: null, cvReviewId: null, jobStartedAt: null }) }).where(eq(applications.id, id)).returning();
    return updated;
  });
}
