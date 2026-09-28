import "server-only";

import { and, asc, eq, isNotNull, ne } from "drizzle-orm";
import { z } from "zod";
import type { modelConnections as ModelConnectionsTable } from "@/lib/db";
import { decryptCredentials, encryptCredentials } from "@/lib/job-applications/credential-crypto";

// Loaded on first use, so code that only needs the .env providers (and its unit tests) never opens a database.
const database = () => import("@/lib/db");
import { connectionKindPresets, connectionKinds, envConnectionIds, type ConnectionKind } from "./connection-kinds";
import { lmStudioConfig } from "./lmstudio";
import { ollamaConfig } from "./ollama";
import { openRouterConfig } from "./openrouter";

export type ModelConnection = {
  id: string;
  name: string;
  kind: ConnectionKind;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  isDefault: boolean;
  embeddingModel: string | null;
  source: "saved" | "env";
  /** Present only on the server, for making requests. */
  apiKey?: string;
  /** Last four characters of the saved key, for the Settings list. */
  keyHint?: string;
  available: boolean;
  unavailableReason?: string;
};

const scope = (id: string) => `model-connection:${id}`;
const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, "");

/** The providers configured in .env.local, used until you save a connection of your own. */
export function envConnections(): ModelConnection[] {
  const ollama = ollamaConfig(), lmstudio = lmStudioConfig(), openRouter = openRouterConfig();
  return [
    { id: "ollama", name: "Ollama (.env)", kind: "ollama", baseUrl: ollama.baseUrl, model: ollama.model, timeoutMs: ollama.timeoutMs, isDefault: false, embeddingModel: null, source: "env", available: true },
    { id: "lmstudio", name: "LM Studio (.env)", kind: "lmstudio", baseUrl: lmstudio.baseUrl, model: lmstudio.model, timeoutMs: lmstudio.timeoutMs, isDefault: false, embeddingModel: null, source: "env", available: true },
    { id: "openrouter", name: "OpenRouter (.env)", kind: "openrouter", baseUrl: openRouter.baseUrl, model: openRouter.model, timeoutMs: openRouter.timeoutMs, isDefault: false, embeddingModel: null, source: "env",
      apiKey: openRouter.apiKey, available: Boolean(openRouter.apiKey), ...(openRouter.apiKey ? {} : { unavailableReason: "OPENROUTER_API_KEY is not set in .env.local." }) },
  ];
}

function fromRow(row: typeof ModelConnectionsTable.$inferSelect, withSecret: boolean): ModelConnection {
  const kind = (connectionKinds as readonly string[]).includes(row.kind) ? row.kind as ConnectionKind : "custom";
  let apiKey: string | undefined, unavailableReason: string | undefined;
  if (row.encryptedApiKey) {
    try { apiKey = decryptCredentials(row.encryptedApiKey, scope(row.id)); }
    catch { unavailableReason = "The saved API key cannot be decrypted. Check ACCOUNT_CREDENTIALS_KEY, or save the key again."; }
  } else if (connectionKindPresets[kind].apiKey === "required") unavailableReason = "An API key is required.";
  return {
    id: row.id, name: row.name, kind, baseUrl: row.baseUrl, model: row.model, timeoutMs: row.timeoutMs,
    isDefault: row.isDefault, embeddingModel: row.embeddingModel, source: "saved",
    ...(withSecret && apiKey ? { apiKey } : {}), ...(apiKey ? { keyHint: apiKey.slice(-4) } : {}),
    available: !unavailableReason, ...(unavailableReason ? { unavailableReason } : {}),
  };
}

export async function savedConnections(withSecrets = false) {
  // Without a database (unit tests, scripts) nothing can have been saved.
  if (!process.env.DATABASE_URL) return [];
  const { db, modelConnections } = await database();
  const rows = await db.select().from(modelConnections).orderBy(asc(modelConnections.createdAt));
  return rows.map((row) => fromRow(row, withSecrets));
}

/** What the model pickers offer: your saved connections, or the .env providers until you save one. */
export async function pickerConnections() {
  const saved = await savedConnections();
  return saved.length ? saved : envConnections();
}

/** A saved connection by id, or one of the .env providers by its legacy name. */
export async function getConnection(id: string): Promise<ModelConnection | null> {
  const env = envConnections().find((item) => item.id === id);
  if (env) return env;
  if (!z.uuid().safeParse(id).success || !process.env.DATABASE_URL) return null;
  const { db, modelConnections } = await database();
  const [row] = await db.select().from(modelConnections).where(eq(modelConnections.id, id)).limit(1);
  return row ? fromRow(row, true) : null;
}

/** The connection background work uses: your default, else the first you saved, else AI_PROVIDER from .env. */
export async function defaultConnectionId(envDefault: string) {
  const saved = await savedConnections();
  return (saved.find((item) => item.isDefault) ?? saved[0])?.id ?? envDefault;
}

/** The saved connection chosen for embeddings, if any; otherwise the .env embedding settings apply. */
export async function embeddingConnection() {
  // Without a database (unit tests, scripts) nothing can have been saved.
  if (!process.env.DATABASE_URL) return null;
  const { db, modelConnections } = await database();
  const [row] = await db.select().from(modelConnections).where(isNotNull(modelConnections.embeddingModel)).limit(1);
  return row ? fromRow(row, true) : null;
}

export const connectionInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(connectionKinds),
  baseUrl: z.string().trim().max(500).refine((value) => { try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; } }, "Enter a full http(s) URL."),
  /** Omitted or empty on an update keeps the saved key; null removes it. */
  apiKey: z.string().trim().max(500).nullable().optional(),
  model: z.string().trim().min(1).max(200),
  timeoutSeconds: z.number().int().min(10).max(3600),
  isDefault: z.boolean().default(false),
  embeddingModel: z.string().trim().max(200).nullable().optional(),
}).strict();
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

export class ConnectionError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

function checkKind(input: ConnectionInput, hasKey: boolean) {
  const preset = connectionKindPresets[input.kind];
  if (preset.apiKey === "required" && !hasKey) throw new ConnectionError(`${preset.label} needs an API key.`);
  if (preset.apiKey === "none" && input.apiKey) throw new ConnectionError(`${preset.label} does not use an API key.`);
  if (input.embeddingModel && !preset.embeddings) throw new ConnectionError(`${preset.label} cannot be used for embeddings here.`);
}

/** Creates or updates a connection. Keeps exactly one default and at most one embedding connection. */
export async function saveConnection(input: ConnectionInput, id?: string) {
  const { db, modelConnections } = await database();
  return db.transaction(async (tx) => {
    const [existing] = id ? await tx.select().from(modelConnections).where(eq(modelConnections.id, id)).limit(1).for("update") : [];
    if (id && !existing) throw new ConnectionError("That connection no longer exists.", 404);
    // An empty or omitted key on an edit keeps the saved one; null removes it.
    const keepKey = Boolean(existing?.encryptedApiKey) && (input.apiKey === undefined || input.apiKey === "");
    checkKind(input, Boolean(input.apiKey) || keepKey);
    const others = await tx.select({ id: modelConnections.id }).from(modelConnections)
      .where(existing ? ne(modelConnections.id, existing.id) : undefined).limit(1);
    // The first connection is always the default, so background work never falls back to .env by surprise.
    const isDefault = input.isDefault || others.length === 0;
    if (isDefault) await tx.update(modelConnections).set({ isDefault: false }).where(eq(modelConnections.isDefault, true));
    const embeddingModel = input.embeddingModel?.trim() || null;
    if (embeddingModel) await tx.update(modelConnections).set({ embeddingModel: null }).where(and(isNotNull(modelConnections.embeddingModel), existing ? ne(modelConnections.id, existing.id) : undefined));
    const values = {
      name: input.name, kind: input.kind, baseUrl: normalizeUrl(input.baseUrl), model: input.model,
      timeoutMs: input.timeoutSeconds * 1000, isDefault, embeddingModel, updatedAt: new Date(),
    };
    const [row] = existing
      ? await tx.update(modelConnections).set(values).where(eq(modelConnections.id, existing.id)).returning()
      : await tx.insert(modelConnections).values(values).returning();
    const encryptedApiKey = input.apiKey ? encryptCredentials(input.apiKey, scope(row.id)) : keepKey ? existing!.encryptedApiKey : null;
    const [saved] = await tx.update(modelConnections).set({ encryptedApiKey }).where(eq(modelConnections.id, row.id)).returning();
    return fromRow(saved, false);
  });
}

/** Deletes a connection; if it was the default, the oldest remaining one takes over. */
export async function deleteConnection(id: string) {
  const { db, modelConnections } = await database();
  return db.transaction(async (tx) => {
    const [removed] = await tx.delete(modelConnections).where(eq(modelConnections.id, id)).returning();
    if (!removed) return false;
    if (removed.isDefault) {
      const [next] = await tx.select({ id: modelConnections.id }).from(modelConnections).orderBy(asc(modelConnections.createdAt)).limit(1);
      if (next) await tx.update(modelConnections).set({ isDefault: true }).where(eq(modelConnections.id, next.id));
    }
    return true;
  });
}

/** Saves the .env providers as editable connections (keeping their URLs, models and OpenRouter key). */
export async function importEnvConnections(envDefault: string) {
  const imported: ModelConnection[] = [];
  for (const env of envConnections()) {
    if (env.kind === "openrouter" && !env.apiKey) continue;
    imported.push(await saveConnection({
      name: env.name.replace(" (.env)", ""), kind: env.kind, baseUrl: env.baseUrl, model: env.model,
      timeoutSeconds: Math.round(env.timeoutMs / 1000), isDefault: env.id === envDefault,
      ...(env.apiKey ? { apiKey: env.apiKey } : {}),
      embeddingModel: env.id === (process.env.EMBEDDING_PROVIDER?.trim() || "ollama") ? (process.env.EMBEDDING_MODEL || connectionKindPresets[env.kind].embeddingPlaceholder) : null,
    }));
  }
  return imported;
}

export { envConnectionIds };

/** A connection safe to send to the browser: everything except the key itself (the list shows its last four characters). */
export function withoutSecret(connection: ModelConnection): Omit<ModelConnection, "apiKey"> {
  const copy = { ...connection };
  delete copy.apiKey;
  return copy;
}
