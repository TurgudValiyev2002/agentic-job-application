import "server-only";

import { z } from "zod";
import { connectionKinds, type ConnectionKind } from "./connection-kinds";
import { getConnection, type ModelConnection } from "./connections";
import { requestEmbeddings } from "./embeddings";
import { providerFromConnection } from "./provider";
import { reachableUrl } from "./host-url";

/** A connection as typed in the Settings form, before (or instead of) saving it. */
export const probeSchema = z.object({
  /** A saved connection; its stored key is used when `apiKey` is empty. */
  id: z.uuid().optional(),
  kind: z.enum(connectionKinds),
  baseUrl: z.string().trim().url().max(500),
  apiKey: z.string().trim().max(500).optional(),
  model: z.string().trim().max(200).optional(),
  embeddingModel: z.string().trim().max(200).optional(),
}).strict();
export type ProbeInput = z.infer<typeof probeSchema>;

export async function probeConnection(input: ProbeInput): Promise<ModelConnection> {
  const saved = input.id ? await getConnection(input.id) : null;
  return {
    id: input.id ?? "draft", name: saved?.name ?? "This connection", kind: input.kind as ConnectionKind, baseUrl: input.baseUrl.replace(/\/+$/, ""),
    model: input.model ?? "", timeoutMs: 60_000, isDefault: false, embeddingModel: input.embeddingModel || null, source: "saved",
    apiKey: input.apiKey || saved?.apiKey, available: true,
  };
}

/** Sends one tiny structured request, the same way every AI step does. */
export async function testConnection(connection: ModelConnection) {
  const started = Date.now();
  const result = await providerFromConnection(connection).requestStructuredCompletion({
    schemaName: "connection_test",
    jsonSchema: { type: "object", additionalProperties: false, required: ["ok"], properties: { ok: { type: "boolean" } } },
    messages: [{ role: "system", content: "Return only JSON." }, { role: "user", content: 'Reply with {"ok": true}.' }],
    maxTokens: 200,
  });
  if (!result.ok) return { ok: false as const, message: result.message };
  try {
    if (JSON.parse(result.content)?.ok !== true) return { ok: false as const, message: "The model answered, but not with the requested JSON. Structured output may be unsupported for this model." };
  } catch { return { ok: false as const, message: "The model answered with text that is not JSON. Structured output may be unsupported for this model." }; }
  let embeddings: string | undefined;
  if (connection.embeddingModel) {
    try {
      const [vector] = await requestEmbeddings(["connection test"], {
        provider: connection.id, native: connection.kind === "ollama", apiKey: connection.apiKey, baseUrl: connection.baseUrl,
        model: connection.embeddingModel, timeoutMs: 60_000, maxChars: 48_000, batchSize: 1, concurrency: 1,
      });
      embeddings = `embeddings OK (${vector.length} dimensions)`;
    } catch (error) { return { ok: false as const, message: `Chat works, but embeddings failed: ${error instanceof Error ? error.message : "unknown error"}` }; }
  }
  return { ok: true as const, message: `Connected in ${((Date.now() - started) / 1000).toFixed(1)} s: structured output works${embeddings ? `, ${embeddings}` : ""}.` };
}

/** Model ids the server offers: Ollama's `/api/tags`, or `/models` on OpenAI-compatible APIs. */
export async function listModels(connection: ModelConnection) {
  const native = connection.kind === "ollama";
  const response = await fetch(reachableUrl(`${connection.baseUrl}${native ? "/api/tags" : "/models"}`), {
    headers: { "ngrok-skip-browser-warning": "true", ...(connection.apiKey ? { Authorization: `Bearer ${connection.apiKey}` } : {}) },
    signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  if (!response.ok) throw new Error(`The server returned HTTP ${response.status} for its model list.`);
  const body = await response.json();
  const ids: unknown[] = native ? (body?.models ?? []).map((item: { name?: unknown }) => item.name) : (body?.data ?? []).map((item: { id?: unknown }) => item.id);
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))].sort().slice(0, 500);
}
