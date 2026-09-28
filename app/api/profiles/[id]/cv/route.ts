import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { applications, cvDocuments, db } from "@/lib/db";
import { uploadCv } from "@/lib/cv/upload";
import { localRequestError } from "@/lib/job-applications/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = localRequestError(request, "multipart/form-data"); if (denied) return denied;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Profile not found." }, { status: 404 });
  const [profile] = await db.select().from(applications).where(and(eq(applications.id, id), isNull(applications.archivedAt))).limit(1);
  if (!profile) return Response.json({ error: "Profile not found." }, { status: 404 });
  const response = await uploadCv(request);
  if (response.status !== 201) return response;
  const document = await response.json();
  const linked = await db.transaction(async tx => {
    const rows = await tx.update(applications).set({ cvDocumentId: document.id, cvReviewId: null,
      cvStatus: document.extractionStatus === "ok" ? "reviewing" : "failed", cvError: document.extractionError,
      jobStartedAt: null, updatedAt: new Date(),
    }).where(and(eq(applications.id, id), isNull(applications.archivedAt))).returning();
    if (!rows.length) return false;
    await tx.update(cvDocuments).set({ applicationId: id, updatedAt: new Date() }).where(eq(cvDocuments.id, document.id));
    return true;
  });
  if (!linked) return Response.json({ error: "Profile was archived during upload." }, { status: 409 });
  return Response.json(document, { status: 201 });
}
