import "server-only";

import {
  requestOpenAiCompatibleCompletion,
  type OpenAiCompatibleResult,
  type StructuredCompletionInput,
} from "./openai-compatible";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type LmStudioConfig = { baseUrl: string; model: string; timeoutMs: number; apiKey?: string };

export function lmStudioConfig(): LmStudioConfig {
  return {
    baseUrl: (process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1").replace(
      /\/+$/,
      "",
    ),
    model: process.env.LMSTUDIO_MODEL || "qwen3.5-2b",
    timeoutMs: positiveInteger(process.env.LMSTUDIO_TIMEOUT_MS, 120_000),
  };
}

export async function requestStructuredCompletion(
  input: StructuredCompletionInput,
  config: LmStudioConfig = lmStudioConfig(),
): Promise<OpenAiCompatibleResult> {
  const result = await requestOpenAiCompatibleCompletion({ ...config, ...input });

  if (result.ok) return result;

  if (result.kind === "http") {
    return {
      ...result,
      message: result.message.replace(
        "The model provider",
        "The local model server",
      ),
    };
  }

  if (result.kind === "invalid_response") {
    return {
      ...result,
      message: result.message.includes("malformed JSON")
        ? "The local model server returned malformed JSON."
        : "The local model returned a response without review content.",
    };
  }

  if (result.kind === "timeout") {
    return {
      ...result,
      message: `The local model did not respond within ${config.timeoutMs} ms.`,
    };
  }

  return {
    ...result,
    message: `The local model server is not reachable at ${config.baseUrl} — is LM Studio running with a model loaded?`,
  };
}
