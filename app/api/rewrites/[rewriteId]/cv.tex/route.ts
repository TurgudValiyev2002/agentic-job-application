import { eq } from "drizzle-orm";
import { z } from "zod";

import { cvContentSchema } from "@/lib/cv/content";
import { cvRewriteDownloadFilename } from "@/lib/cv/download-filename";
import { cvRewrites, db, jobPostings } from "@/lib/db";

export async function GET(
  _request: Request,
  context: { params: Promise<{ rewriteId: string }> },
) {
  const { rewriteId } = await context.params;
  if (!z.uuid().safeParse(rewriteId).success) {
    return Response.json({ error: "CV rewrite not found." }, { status: 404 });
  }

  const [rewrite] = await db
    .select({
      status: cvRewrites.status,
      content: cvRewrites.content,
      latex: cvRewrites.latex,
      company: jobPostings.company,
      jobTitle: jobPostings.title,
    })
    .from(cvRewrites)
    .leftJoin(jobPostings, eq(cvRewrites.jobPostingId, jobPostings.id))
    .where(eq(cvRewrites.id, rewriteId))
    .limit(1);
  const parsedContent = cvContentSchema.safeParse(rewrite?.content);
  if (
    rewrite?.status !== "completed" ||
    !rewrite.latex ||
    !parsedContent.success
  ) {
    return Response.json({ error: "CV rewrite not found." }, { status: 404 });
  }

  const filename = cvRewriteDownloadFilename({
    name: parsedContent.data.name,
    company: rewrite.company,
    jobTitle: rewrite.jobTitle,
    extension: "tex",
  });
  return new Response(rewrite.latex, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
