import "server-only";

import { setTimeout as delay } from "node:timers/promises";

import { fetchFailureReason, longFetch, TRANSPORT_RETRY_DELAY_MS } from "./long-request";
import type { OpenAiCompatibleResult, StructuredCompletionInput } from "./openai-compatible";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type OllamaConfig = { baseUrl: string; model: string; timeoutMs: number; apiKey?: string; label?: string };

export function ollamaConfig(): OllamaConfig {
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL || "http://localhost:11434")
      .replace(/\/+$/, "").replace(/\/(?:api|v1)$/, ""),
    model: process.env.OLLAMA_MODEL || "gemma4:26b",
    timeoutMs: positiveInteger(process.env.OLLAMA_TIMEOUT_MS, 240_000),
  };
}

export async function requestStructuredCompletion(
  input: StructuredCompletionInput,
  config: OllamaConfig = ollamaConfig(),
): Promise<OpenAiCompatibleResult> {
  const startedAt = Date.now();
  const first = await attemptStructuredCompletion(input, startedAt, config);
  if (first.ok || first.kind !== "unreachable") return first;
  // A tunnel or socket reset mid-generation is transient and the request is
  // deterministic (temperature 0), so one re-send is cheap insurance against
  // failing a whole CV over a network blip.
  await delay(TRANSPORT_RETRY_DELAY_MS);
  const second = await attemptStructuredCompletion(input, startedAt, config);
  return second.ok ? second : { ...second, message: `${second.message} (retried once)` };
}

async function attemptStructuredCompletion(
  input: StructuredCompletionInput,
  startedAt: number,
  { baseUrl, model, timeoutMs, apiKey }: OllamaConfig,
): Promise<OpenAiCompatibleResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const failure = (kind: "http" | "timeout" | "unreachable" | "invalid_response", message: string, httpStatus?: number): OpenAiCompatibleResult => ({
    ok: false, kind, message, model, durationMs: Date.now() - startedAt,
    ...(httpStatus ? { httpStatus } : {}),
  });

  try {
    const response = await longFetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({
        model,
        messages: input.messages.map((message) => message.role === "system" ? { ...message, content: `${message.content}\n\nResponse JSON schema:\n${JSON.stringify(input.jsonSchema)}` } : message),
        format: input.jsonSchema,
        stream: false,
        think: false,
        options: {
          temperature: 0,
          num_predict: input.maxTokens ?? positiveInteger(process.env.AI_MAX_TOKENS, 8000),
          num_ctx: positiveInteger(process.env.OLLAMA_CONTEXT_LENGTH, 32768),
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    }, timeoutMs);
    if (!response.ok) {
      return failure("http", response.status === 404
        ? `Ollama could not find ${model}. Check the model name and that the URL points to Ollama.`
        : `Ollama returned HTTP ${response.status}. Check that the server (and any tunnel in front of it) is running.`, response.status);
    }
    let rawResponse;
    try {
      rawResponse = await response.json();
    } catch {
      if (controller.signal.aborted) throw new Error("timeout");
      return failure("invalid_response", "Ollama returned malformed JSON. Check that the tunnel points to the Ollama API.");
    }
    if (rawResponse?.error) return failure("http", "Ollama could not complete the request. Check the model server logs.");
    if (rawResponse?.done_reason === "length") {
      return failure("invalid_response", "Ollama reached its output limit. Increase AI_MAX_TOKENS and try again.");
    }
    const content = rawResponse?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return failure("invalid_response", "Ollama returned no content. Check that the model is loaded and try again.");
    }
    return { ok: true, content, model, rawResponse, durationMs: Date.now() - startedAt };
  } catch (error) {
    return controller.signal.aborted
      ? failure("timeout", `Ollama did not respond within ${timeoutMs / 1000} seconds. Try again after the model has loaded.`)
      : failure("unreachable", `Ollama is unreachable at ${baseUrl} (${fetchFailureReason(error)}). Check the server, any tunnel in front of it, and the connection URL.`);
  } finally {
    clearTimeout(timeout);
  }
}
