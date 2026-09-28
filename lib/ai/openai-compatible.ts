import "server-only";

import { reachableUrl } from "./host-url";

export type OpenAiCompatibleMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OpenAiCompatibleFailureKind =
  | "configuration"
  | "unreachable"
  | "timeout"
  | "http"
  | "invalid_response";

export type OpenAiCompatibleResult =
  | {
      ok: true;
      content: string;
      model: string;
      rawResponse: unknown;
      durationMs: number;
    }
  | {
      ok: false;
      kind: OpenAiCompatibleFailureKind;
      message: string;
      model: string;
      durationMs: number;
      httpStatus?: number;
    };

export type StructuredCompletionInput = {
  messages: OpenAiCompatibleMessage[];
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  maxTokens?: number;
};

type OpenAiCompatibleRequest = StructuredCompletionInput & {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs: number;
  maxTokens?: number;
  headers?: Record<string, string>;
};

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function redact(value: string, secrets: Array<string | undefined>) {
  return secrets.reduce<string>(
    (redacted, secret) =>
      secret ? redacted.replaceAll(secret, "[REDACTED]") : redacted,
    value,
  );
}

export async function requestOpenAiCompatibleCompletion({
  baseUrl,
  apiKey,
  model,
  timeoutMs,
  maxTokens = positiveInteger(process.env.AI_MAX_TOKENS, 8000),
  headers,
  messages,
  schemaName,
  jsonSchema,
}: OpenAiCompatibleRequest): Promise<OpenAiCompatibleResult> {
  const url = `${baseUrl}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(reachableUrl(url), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        ...headers,
      },
      body: JSON.stringify({
        model,
        messages,
        // Reasoning models spend part of the completion budget on reasoning tokens
        // before any content is emitted. Without an explicit ceiling the provider
        // default can leave nothing for the actual answer, which surfaces as an
        // empty content field rather than an error.
        max_tokens: maxTokens,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: schemaName,
            strict: true,
            schema: jsonSchema,
          },
        },
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = redact(
        (await response.text()).slice(0, 500).trim(),
        [apiKey],
      );
      return {
        ok: false,
        kind: "http",
        message: `The model provider returned HTTP ${response.status}${detail ? `: ${detail}` : "."}`,
        model,
        durationMs: Date.now() - startedAt,
        httpStatus: response.status,
      };
    }

    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch {
      // The abort can fire while the body is still streaming. That surfaces here
      // as a JSON parse failure, but the real cause is the timeout - report it as
      // such so the message is actionable instead of blaming the model's output.
      if (controller.signal.aborted) {
        return {
          ok: false,
          kind: "timeout",
          message: `The model provider did not respond within ${timeoutMs} ms.`,
          model,
          durationMs: Date.now() - startedAt,
        };
      }

      return {
        ok: false,
        kind: "invalid_response",
        message: "The model provider returned malformed JSON.",
        model,
        durationMs: Date.now() - startedAt,
      };
    }

    const durationMs = Date.now() - startedAt;

    // OpenRouter can answer HTTP 200 with an error object in the body (e.g. an
    // overloaded upstream provider). Surface that message instead of reporting a
    // generic "no content", which hides the real cause.
    if (
      typeof rawResponse === "object" &&
      rawResponse !== null &&
      "error" in rawResponse &&
      rawResponse.error
    ) {
      const err = rawResponse.error as { message?: string; code?: number };
      const code = typeof err.code === "number" ? err.code : undefined;
      const kind =
        code === 429
          ? "http"
          : code !== undefined && code >= 500
            ? "unreachable"
            : "http";

      return {
        ok: false,
        kind,
        message: redact(
          err.message || "The model provider returned an error.",
          [apiKey],
        ),
        model,
        durationMs,
        ...(code !== undefined ? { httpStatus: code } : {}),
      };
    }

    const content =
      typeof rawResponse === "object" &&
      rawResponse !== null &&
      "choices" in rawResponse &&
      Array.isArray(rawResponse.choices) &&
      typeof rawResponse.choices[0]?.message?.content === "string"
        ? rawResponse.choices[0].message.content
        : undefined;

    if (!content) {
      if (controller.signal.aborted) {
        return {
          ok: false,
          kind: "timeout",
          message: `The model provider did not respond within ${timeoutMs} ms.`,
          model,
          durationMs,
        };
      }

      const choice =
        typeof rawResponse === "object" &&
        rawResponse !== null &&
        "choices" in rawResponse &&
        Array.isArray(rawResponse.choices)
          ? rawResponse.choices[0]
          : undefined;
      const finishReason = choice?.finish_reason ?? "unknown";
      const reasonedOnly = Boolean(choice?.message?.reasoning);

      return {
        ok: false,
        kind: "invalid_response",
        message:
          `The model returned no content (finish_reason: ${finishReason}` +
          `${reasonedOnly ? ", reasoning tokens only" : ""}). ` +
          "Try again, or use a model that is not reasoning-heavy.",
        model,
        durationMs,
      };
    }

    return { ok: true, content, model, rawResponse, durationMs };
  } catch {
    const durationMs = Date.now() - startedAt;

    if (controller.signal.aborted) {
      return {
        ok: false,
        kind: "timeout",
        message: `The model provider did not respond within ${timeoutMs} ms.`,
        model,
        durationMs,
      };
    }

    return {
      ok: false,
      kind: "unreachable",
      message: `The model provider is not reachable at ${redact(baseUrl, [apiKey])}.`,
      model,
      durationMs,
    };
  } finally {
    clearTimeout(timeout);
  }
}
