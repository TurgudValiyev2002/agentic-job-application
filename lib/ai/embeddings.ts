import "server-only";
import { longFetch } from "./long-request";
import { ollamaConfig } from "./ollama";
import { embeddingConnection } from "./connections";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export type EmbeddingConfig = ReturnType<typeof embeddingConfig>;

/** Embedding settings from .env.local, used when no saved connection is marked for embeddings. */
export function embeddingConfig() {
  const provider = process.env.EMBEDDING_PROVIDER?.trim() || "ollama";
  if (provider !== "ollama" && provider !== "lmstudio") throw new Error("EMBEDDING_PROVIDER must be ollama or lmstudio.");
  return {
    provider: provider as string,
    /** Ollama's native `/api/embed`; everything else speaks OpenAI's `/embeddings`. */
    native: provider === "ollama",
    apiKey: undefined as string | undefined,
    baseUrl: provider === "ollama" ? ollamaConfig().baseUrl : (process.env.LMSTUDIO_BASE_URL || "http://localhost:1234/v1").replace(/\/+$/, ""),
    model: process.env.EMBEDDING_MODEL || (provider === "ollama" ? "qwen3-embedding:4b" : "text-embedding-bge-m3"),
    timeoutMs: positiveInteger(process.env.EMBEDDING_TIMEOUT_MS, 60_000),
    maxChars: positiveInteger(process.env.EMBEDDING_MAX_CHARS, 48_000),
    batchSize: Math.min(positiveInteger(process.env.EMBEDDING_BATCH_SIZE, 8), 32),
    concurrency: Math.min(positiveInteger(process.env.EMBEDDING_CONCURRENCY, 1), 4),
  };
}

/** The saved connection marked for embeddings (Settings), else the .env settings. */
export async function resolveEmbeddingConfig(): Promise<EmbeddingConfig> {
  const base = embeddingConfig();
  const connection = await embeddingConnection();
  if (!connection?.embeddingModel) return base;
  return { ...base, provider: connection.id, native: connection.kind === "ollama", apiKey: connection.apiKey, baseUrl: connection.baseUrl, model: connection.embeddingModel };
}

export async function requestEmbeddings(inputs: string[], config: EmbeddingConfig = embeddingConfig()): Promise<number[][]> {
  const native = config.native;
  const response = await longFetch(`${config.baseUrl}${native ? "/api/embed" : "/embeddings"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(native ? { "ngrok-skip-browser-warning": "true" } : {}), ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}) },
    body: JSON.stringify({ model: config.model, input: inputs, ...(native ? { truncate: false } : {}) }),
    cache: "no-store", signal: AbortSignal.timeout(config.timeoutMs),
  }, config.timeoutMs);
  if (!response.ok) throw new Error(`Embedding server returned HTTP ${response.status}.`);
  const body = await response.json();
  let vectors: unknown;
  if (native) vectors = body?.embeddings;
  else {
    if (!Array.isArray(body?.data)) throw new Error("Embedding server returned malformed data.");
    const indexes = new Set<number>();
    vectors = body.data.map((item: { index: number; embedding: unknown }) => {
      if (!Number.isInteger(item.index) || item.index < 0 || item.index >= inputs.length || indexes.has(item.index)) throw new Error("Embedding server returned invalid vector indexes.");
      indexes.add(item.index);
      return item;
    }).sort((a: { index: number }, b: { index: number }) => a.index - b.index).map((item: { embedding: unknown }) => item.embedding);
  }
  if (!Array.isArray(vectors) || vectors.length !== inputs.length || vectors.some((vector) =>
    !Array.isArray(vector) || !vector.length || vector.length !== vectors[0]?.length ||
    !vector.every((n: unknown) => typeof n === "number" && Number.isFinite(n)) ||
    !vector.some((n: number) => n !== 0))) throw new Error("Embedding server returned invalid or inconsistent vectors.");
  return vectors as number[][];
}
