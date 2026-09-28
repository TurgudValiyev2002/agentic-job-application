import "server-only";

import { lmStudioConfig, requestStructuredCompletion as requestLmStudioCompletion } from "./lmstudio";
import { openRouterConfig, requestStructuredCompletion as requestOpenRouterCompletion } from "./openrouter";
import { ollamaConfig, requestStructuredCompletion as requestOllamaCompletion } from "./ollama";
import { requestOpenAiCompatibleCompletion, type OpenAiCompatibleResult, type StructuredCompletionInput } from "./openai-compatible";
import { privacyNotice } from "./connection-kinds";
import { defaultConnectionId, envConnections, getConnection, pickerConnections, type ModelConnection } from "./connections";
import type { AiProviderName, SelectableAiProvider } from "./provider-ui";

export type { AiProviderName, SelectableAiProvider } from "./provider-ui";

/** AI_PROVIDER from .env.local; used only when no connection has been saved on the Settings page. */
export function defaultAiProviderName(): AiProviderName {
  const configured = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (!configured || configured === "lmstudio") return "lmstudio";
  if (configured === "ollama" || configured === "openrouter") return configured;
  throw new Error(`Invalid AI_PROVIDER "${process.env.AI_PROVIDER}". Use "lmstudio", "ollama", or "openrouter".`);
}

/** Turns a connection into the request function every AI step calls. */
export function providerFromConnection(connection: ModelConnection) {
  const { baseUrl, model, timeoutMs, apiKey, kind, name } = connection;
  const request = (input: StructuredCompletionInput): Promise<OpenAiCompatibleResult> => {
    if (kind === "ollama") return requestOllamaCompletion(input, { baseUrl, model, timeoutMs, apiKey });
    if (kind === "lmstudio") return requestLmStudioCompletion(input, { baseUrl, model, timeoutMs, apiKey });
    if (kind === "openrouter") return requestOpenRouterCompletion(input, { ...openRouterConfig(), baseUrl, model, timeoutMs, apiKey });
    return requestOpenAiCompatibleCompletion({ baseUrl, apiKey, model, timeoutMs, ...input }).then((result) =>
      result.ok ? result : { ...result, message: result.message.replace("The model provider", name) });
  };
  return {
    /** The connection id, stored on runs, reviews and rewrites. */
    providerName: connection.id,
    label: name,
    kind,
    model,
    endpoint: baseUrl,
    requestStructuredCompletion: request,
  };
}

export type ActiveAiProvider = ReturnType<typeof providerFromConnection>;

/** Synchronous access to the .env providers, kept for defaults and tests. Saved connections use `resolveAiProvider`. */
export function activeAiProvider(providerName: AiProviderName = defaultAiProviderName()): ActiveAiProvider {
  const env = envConnections().find((item) => item.id === providerName);
  if (!env) throw new Error(`"${providerName}" is a saved connection; resolve it with resolveAiProvider().`);
  return providerFromConnection(env);
}

export class ProviderUnavailableError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** The connection id background work and pickers start from: your default connection, else AI_PROVIDER. */
export function defaultProviderId() {
  return defaultConnectionId(defaultAiProviderName());
}

/** Resolves a connection id (or the default) to a ready provider; throws when it is missing or unusable. */
export async function resolveAiProvider(providerName?: AiProviderName): Promise<ActiveAiProvider> {
  const id = providerName ?? await defaultProviderId();
  const connection = await getConnection(id);
  if (!connection) throw new ProviderUnavailableError("That model connection no longer exists. Choose another on the Settings page.", 404);
  if (!connection.available) throw new ProviderUnavailableError(connection.unavailableReason ?? `${connection.name} is not available.`);
  return providerFromConnection(connection);
}

export async function selectableAiProviders(): Promise<SelectableAiProvider[]> {
  return (await pickerConnections()).map((connection) => ({
    name: connection.id, label: `${connection.name} · ${connection.model}`, model: connection.model, kind: connection.kind,
    privacyNotice: privacyNotice(connection.kind, connection.baseUrl), available: connection.available,
    ...(connection.unavailableReason ? { unavailableReason: connection.unavailableReason } : {}),
  }));
}

export { lmStudioConfig, ollamaConfig };
