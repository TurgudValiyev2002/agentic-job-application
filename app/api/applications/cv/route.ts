import { eq } from "drizzle-orm";

import { buildCvFromApplication } from "@/lib/cv/from-application";
import { cvContentSchema } from "@/lib/cv/content";
import { saveRewriteAsCvDocument } from "@/lib/cv/saved-document";
import { cvRewrites, db } from "@/lib/db";
import { getLatestApplication } from "@/lib/db/queries";
import { renderCvToLatex } from "@/lib/latex/render-cv";

// Builds a CV directly from the application form. No model is involved: the form
// is already structured, so this is a pure mapping that cannot invent anything.
export async function POST(request: Request) {
  const body = (await request.text()).trim();
  if (body && body !== "{}") {
    return Response.json(
      { error: "This endpoint accepts no request fields." },
      { status: 400 },
    );
  }

  const application = await getLatestApplication();
  if (!application) {
    return Response.json(
      { error: "Fill in the application form before generating a CV." },
      { status: 409 },
    );
  }

  const content = buildCvFromApplication(application);
  const parsed = cvContentSchema.safeParse(content);
  if (!parsed.success) {
    return Response.json(
      {
        error:
          "The application form does not yet contain enough detail for a CV. Add your experience and education, then try again.",
      },
      { status: 409 },
    );
  }

  const latex = renderCvToLatex(parsed.data);

  const existing = await db
    .select({ id: cvRewrites.id })
    .from(cvRewrites)
    .where(eq(cvRewrites.applicationId, application.id))
    .limit(1);

  const values = {
    applicationId: application.id,
    status: "completed" as const,
    provider: "none",
    model: "form",
    promptVersion: "form-v1",
    content: parsed.data,
    latex,
    completedAt: new Date(),
  };

  const [row] = existing.length
    ? await db
        .update(cvRewrites)
        .set(values)
        .where(eq(cvRewrites.id, existing[0].id))
        .returning({ id: cvRewrites.id })
    : await db.insert(cvRewrites).values(values).returning({ id: cvRewrites.id });

  // Also written out as a readable CV so the reviewer can pick it up straight
  // away. It only becomes the pipeline's CV once the user saves it there.
  const document = await saveRewriteAsCvDocument(row.id, { select: false });

  return Response.json({
    rewriteId: row.id,
    cvDocumentId: document.id,
    name: parsed.data.name,
    experience: parsed.data.experience.length,
    education: parsed.data.education.length,
    skills: parsed.data.skills.length,
  });
}
