import { z } from "zod";
import { eq } from "drizzle-orm";
import { applicationView, commandApplication, ApplicationError } from "@/lib/job-applications/store";
import { localRequestError } from "@/lib/job-applications/http";
import { draftAnswer } from "@/lib/job-applications/draft";
import { db, cvDocuments, jobApplications } from "@/lib/db";
import { reviewStatuses } from "@/lib/job-applications/types";
const commandSchema = z.object({ action: z.enum(["update", "submit", "cancel", "draft", "save_draft"]), revision: z.number().int().nonnegative(), answers: z.record(z.string().max(100), z.string().max(10000)).optional(), fieldId: z.string().max(100).optional() }).strict();
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  const denied = localRequestError(request); if (denied) return denied;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "Application not found." }, { status: 404 });
  const view = await applicationView(id);
  return view ? Response.json(view) : Response.json({ error: "Application not found." }, { status: 404 });
}
export async function POST(request: Request, context: Context) {
  const denied = localRequestError(request); if (denied) return denied;
  const { id } = await context.params;
  const parsed = commandSchema.safeParse(await request.json().catch(() => null));
  if (!z.uuid().safeParse(id).success || !parsed.success) return Response.json({ error: "Invalid application request." }, { status: 400 });
  try {
    const { action, revision, answers, fieldId } = parsed.data;
    if (action === "draft") {
      const [row] = await db.select({ run: jobApplications, cvText: cvDocuments.extractedText }).from(jobApplications).innerJoin(cvDocuments, eq(cvDocuments.id, jobApplications.cvDocumentId)).where(eq(jobApplications.id, id)).limit(1);
      const field = row?.run.snapshot?.fields.find((item) => item.id === fieldId);
      if (!row || !field || row.run.revision !== revision || !reviewStatuses.includes(row.run.status)) throw new ApplicationError("Refresh the application before drafting an answer.");
      return Response.json(await draftAnswer(field, row.cvText ?? "", row.run.profile));
    }
    await commandApplication(id, action, revision, answers);
    return Response.json(await applicationView(id));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Application request failed." }, { status: error instanceof ApplicationError ? error.status : 500 }); }
}
