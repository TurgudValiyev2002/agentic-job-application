import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import type { ActiveAiProvider } from "./provider";

export const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function aiCacheKey(kind: string, input: unknown, provider: Pick<ActiveAiProvider, "providerName" | "model"> & Partial<Pick<ActiveAiProvider, "endpoint">>, version: string) {
  // The connection's own URL: the same model name served elsewhere is a different model.
  const endpoint = provider.endpoint ?? (provider.providerName === "ollama" ? process.env.OLLAMA_BASE_URL : provider.providerName === "lmstudio" ? process.env.LMSTUDIO_BASE_URL : process.env.OPENROUTER_BASE_URL);
  return createHash("sha256").update(JSON.stringify(canonical({ kind, input, provider: provider.providerName, model: provider.model, endpoint, version,
    contextLength: process.env.OLLAMA_CONTEXT_LENGTH, epoch: process.env.AI_CACHE_VERSION ?? "1" }))).digest("hex");
}
function filename(key: string) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Invalid AI cache key.");
  return path.join(process.env.AI_RESULT_CACHE_DIR ?? path.join(process.cwd(), ".cache", "ai-results"), `${key}.json`);
}
export async function readAiCache<T>(key: string, schema: z.ZodType<T>): Promise<T | null> {
  if (process.env.AI_CACHE_ENABLED === "false") return null;
  try {
    const entry = JSON.parse(await readFile(filename(key), "utf8"));
    const age = Date.now() - entry.createdAt;
    if (typeof entry.createdAt !== "number" || !Number.isFinite(age) || age < 0 || age >= AI_CACHE_TTL_MS) return null;
    const parsed = schema.safeParse(entry.value);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export async function writeAiCache(key: string, value: unknown) {
  if (process.env.AI_CACHE_ENABLED === "false") return;
  try {
    const target = filename(key);
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ createdAt: Date.now(), value }), { mode: 0o600 });
    await rename(temporary, target);
  } catch { console.warn("AI result cache could not be saved; continuing with the verified result."); }
}
