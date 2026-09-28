import "server-only";

import {
  requestOpenAiCompatibleCompletion,
  type OpenAiCompatibleResult,
  type StructuredCompletionInput,
} from "./openai-compatible";

export const OPENROUTER_DEFAULT_MODEL =
  "nvidia/nemotron-3-super-120b-a12b:free";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalHeader(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export type OpenRouterConfig = { baseUrl: string; apiKey?: string; model: string; timeoutMs: number; headers: Record<string, string> };

export function openRouterConfig(): OpenRouterConfig {
  const siteUrl = optionalHeader(process.env.OPENROUTER_SITE_URL);
  const siteName = optionalHeader(process.env.OPENROUTER_SITE_NAME);

  return {
    baseUrl: (
      process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1"
    ).replace(/\/+$/, ""),
    apiKey: process.env.OPENROUTER_API_KEY?.trim() || undefined,
    model: process.env.OPENROUTER_MODEL || OPENROUTER_DEFAULT_MODEL,
    timeoutMs: positiveInteger(process.env.OPENROUTER_TIMEOUT_MS, 120_000),
    headers: {
      ...(siteUrl ? { "HTTP-Referer": siteUrl } : {}),
      ...(siteName ? { "X-Title": siteName } : {}),
    },
  };
}

function openRouterHttpFailure(
  result: Extract<OpenAiCompatibleResult, { ok: false }>,
  model: string,
): OpenAiCompatibleResult {
  if (result.kind !== "http") return result;

  if (result.httpStatus === 401) {
    return {
      ...result,
      message:
        "OpenRouter rejected the API key. Check the key saved for this connection.",
    };
  }

  if (result.httpStatus === 402) {
    return {
      ...result,
      message:
        "The OpenRouter account is out of credits. Add credits or choose an available free model, then try again.",
    };
  }

  if (result.httpStatus === 429) {
    return {
      ...result,
      message:
        "OpenRouter rate limited the review request. This is common on :free models; please retry later.",
    };
  }

  if (result.httpStatus === 403 && model.endsWith(":free")) {
    return {
      ...result,
      message:
        "OpenRouter refused access to the free model. OpenRouter free models can require prompt/data logging to be enabled in the account privacy settings.",
    };
  }

  if (result.httpStatus !== undefined && result.httpStatus >= 500) {
    return {
      ...result,
      kind: "unreachable",
      message:
        "OpenRouter is temporarily unavailable. Please retry the CV review later.",
    };
  }

  return {
    ...result,
    message: result.message.replace("The model provider", "OpenRouter"),
  };
}

export async function requestStructuredCompletion(
  input: StructuredCompletionInput,
  config: OpenRouterConfig = openRouterConfig(),
): Promise<OpenAiCompatibleResult> {
  if (!config.apiKey) {
    return {
      ok: false,
      kind: "configuration",
      message:
        "The OpenRouter API key is missing. Add it to this connection on the Settings page (or OPENROUTER_API_KEY in .env.local).",
      model: config.model,
      durationMs: 0,
    };
  }

  const result = await requestOpenAiCompatibleCompletion({ ...config, ...input });
  if (result.ok) return result;

  if (result.kind === "timeout") {
    return {
      ...result,
      message: `OpenRouter did not respond within ${config.timeoutMs} ms. Please retry later.`,
    };
  }

  if (result.kind === "unreachable") {
    return {
      ...result,
      message: "OpenRouter is not reachable. Please retry the CV review later.",
    };
  }

  if (result.kind === "invalid_response") {
    return {
      ...result,
      message: result.message.replace("The model provider", "OpenRouter"),
    };
  }

  return openRouterHttpFailure(result, config.model);
}
