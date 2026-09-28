import { z } from "zod";

import { saveRewriteAsCvDocument, SavedCvError } from "@/lib/cv/saved-document";

// Makes an improved CV the pipeline's CV. Same local, single-user boundary as
// the other CV endpoints.
export async function POST(
  _request: Request,
  context: { params: Promise<{ rewriteId: string }> },
) {
  const { rewriteId } = await context.params;
  if (!z.uuid().safeParse(rewriteId).success) {
    return Response.json({ error: "CV rewrite not found." }, { status: 404 });
  }

  try {
    const document = await saveRewriteAsCvDocument(rewriteId, { select: true });
    return Response.json({ document }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SavedCvError) return Response.json({ error: error.message }, { status: error.status });
    console.error("Failed to save the improved CV", error);
    return Response.json({ error: "The improved CV could not be saved. Please try again." }, { status: 500 });
  }
}
