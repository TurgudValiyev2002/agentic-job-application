import "server-only";

import { searchPreferencesSchema, type SearchPreferences } from "../jobs/preferences";
import { z } from "zod";

import { providerIdSchema } from "./connection-kinds";
import { ProviderUnavailableError, resolveAiProvider, type AiProviderName } from "./provider";

const rewriteRequestSchema = z
  .object({
    cvDocumentId: z.uuid().optional(),
    preferences: searchPreferencesSchema.optional(),
    provider: providerIdSchema.optional(),
  })
  .strict();

export type RewriteRequestParseResult =
  | { ok: true; provider?: AiProviderName; cvDocumentId?: string; preferences?: SearchPreferences }
  | { ok: false; message: string };

export async function parseRewriteRequest(
  request: Request,
): Promise<RewriteRequestParseResult> {
  const body = await request.text();
  if (!body.trim()) return { ok: true };

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return {
      ok: false,
      message:
        'Request body must be JSON with an optional provider (a model connection id).',
    };
  }

  const parsed = rewriteRequestSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        'provider must be a model connection id, and no other request fields are accepted.',
    };
  }

  return { ok: true, ...parsed.data };
}

/** Resolves the chosen connection (or the default) for a request, as a result instead of an exception. */
export async function resolveRewriteProvider(providerName?: AiProviderName) {
  try {
    return { ok: true as const, provider: await resolveAiProvider(providerName) };
  } catch (error) {
    return {
      ok: false as const,
      status: error instanceof ProviderUnavailableError ? error.status : 503,
      message: error instanceof Error ? error.message : "The AI provider configuration is invalid.",
    };
  }
}


export function rewriteFailureStatus(result: {
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
