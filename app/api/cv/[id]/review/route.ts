import type { NextRequest } from "next/server";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { runStoredCvReview } from "@/lib/ai/run-cv-review";
import type { AiProviderName } from "@/lib/ai/provider";
import { resolveRewriteProvider } from "@/lib/ai/cv-rewrite-request";
import { cvDocuments, db } from "@/lib/db";
import { providerIdSchema } from "@/lib/ai/connection-kinds";

const reviewRequestSchema = z
  .object({
    provider: providerIdSchema.optional(),
  })
  .strict();

type ReviewRequestParseResult =
  | { ok: true; provider?: AiProviderName }
  | { ok: false; message: string };

async function parseReviewRequest(
  request: NextRequest,
): Promise<ReviewRequestParseResult> {
  const body = await request.text();
  if (!body.trim()) return { ok: true };

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return {
      ok: false,
      message:
        'Request body must be JSON with an optional provider set to "lmstudio", "ollama", or "openrouter".',
    };
  }

  const parsed = reviewRequestSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        'provider must be "lmstudio", "ollama", or "openrouter", and no other request fields are accepted.',
    };
  }

  return { ok: true, provider: parsed.data.provider };
}

function failureStatus(result: {
  kind:
    | "configuration"
    | "unreachable"
    | "timeout"
    | "http"
    | "invalid_response";
  httpStatus?: number;
}) {
  if (result.kind === "configuration" || result.kind === "unreachable") return 503;
  if (result.kind === "timeout") return 504;
  if (result.kind === "http" && result.httpStatus === 402) return 402;
  if (result.kind === "http" && result.httpStatus === 429) return 429;
  return 502;
}

// This endpoint is public and unauthenticated. Add authentication and rate
// limiting here before exposing it in a production environment.
export async function POST(
  request: NextRequest,
  context: RouteContext<"/api/cv/[id]/review">,
) {
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) {
    return Response.json({ error: "CV document not found." }, { status: 404 });
  }

  const [document] = await db
    .select({
      extractionStatus: cvDocuments.extractionStatus,
      extractionError: cvDocuments.extractionError,
      extractedText: cvDocuments.extractedText,
    })
    .from(cvDocuments)
    .where(eq(cvDocuments.id, id))
    .limit(1);

  if (!document) {
    return Response.json({ error: "CV document not found." }, { status: 404 });
  }

  if (document.extractionStatus !== "ok" || !document.extractedText) {
    return Response.json(
      {
        error:
          document.extractionError ||
          "CV review is unavailable because text extraction did not succeed.",
      },
      { status: 409 },
    );
  }

  const parsedRequest = await parseReviewRequest(request);
  if (!parsedRequest.ok) {
    return Response.json({ error: parsedRequest.message }, { status: 400 });
  }

  const selected = await resolveRewriteProvider(parsedRequest.provider);
  if (!selected.ok) return Response.json({ error: selected.message }, { status: selected.status });
  const provider = selected.provider;

  const { result, reviewId } = await runStoredCvReview({ cvDocumentId: id, provider });
  if (!result.ok) return Response.json(
    { error: result.message, kind: result.kind, reviewId }, { status: failureStatus(result) },
  );

  return Response.json({
    reviewId,
    provider: result.providerName,
    model: result.model,
    truncated: result.truncated,
    ...result.review,
  });
}
