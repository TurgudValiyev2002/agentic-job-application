// Shared by the server and the Settings form: what each kind of model connection needs.
import { z } from "zod";
export const connectionKinds = ["ollama", "lmstudio", "custom", "openai", "openrouter"] as const;
export type ConnectionKind = (typeof connectionKinds)[number];

export type ConnectionKindPreset = {
  label: string;
  description: string;
  baseUrl: string;
  /** "required" for platforms, "optional" for links that may sit behind a proxy, "none" for local servers. */
  apiKey: "required" | "optional" | "none";
  modelPlaceholder: string;
  timeoutMs: number;
  /** Whether this kind can also serve embeddings (Ollama's /api/embed or an OpenAI-style /embeddings). */
  embeddings: boolean;
  embeddingPlaceholder: string;
};

export const connectionKindPresets: Record<ConnectionKind, ConnectionKindPreset> = {
  ollama: {
    label: "Ollama",
    description: "An Ollama server on this machine, your network, or behind a tunnel such as ngrok.",
    baseUrl: "http://localhost:11434", apiKey: "optional", modelPlaceholder: "gemma4:26b", timeoutMs: 240_000,
    embeddings: true, embeddingPlaceholder: "qwen3-embedding:4b",
  },
  lmstudio: {
    label: "LM Studio",
    description: "LM Studio's local server with a model loaded.",
    baseUrl: "http://localhost:1234/v1", apiKey: "none", modelPlaceholder: "qwen3.5-2b", timeoutMs: 120_000,
    embeddings: true, embeddingPlaceholder: "text-embedding-bge-m3",
  },
  custom: {
    label: "API link",
    description: "Any OpenAI-compatible endpoint (vLLM, llama.cpp, LiteLLM, a hosted gateway). Add a key if it needs one.",
    baseUrl: "", apiKey: "optional", modelPlaceholder: "model id", timeoutMs: 120_000,
    embeddings: true, embeddingPlaceholder: "embedding model id",
  },
  openai: {
    label: "OpenAI",
    description: "OpenAI's API with your API key.",
    baseUrl: "https://api.openai.com/v1", apiKey: "required", modelPlaceholder: "model id, or Load models", timeoutMs: 120_000,
    embeddings: true, embeddingPlaceholder: "text-embedding-3-small",
  },
  openrouter: {
    label: "OpenRouter",
    description: "One key for hundreds of hosted models.",
    baseUrl: "https://openrouter.ai/api/v1", apiKey: "required", modelPlaceholder: "nvidia/nemotron-3-super-120b-a12b:free", timeoutMs: 120_000,
    embeddings: false, embeddingPlaceholder: "",
  },
};

/** The ids the .env-configured providers have always used; runs and schedules saved before Settings existed keep resolving. */
export const envConnectionIds = ["ollama", "lmstudio", "openrouter"] as const;

export function isLocalUrl(url: string) {
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "host.docker.internal";
  } catch { return false; }
}

/** Where the CV text goes, in the words shown next to every model picker. */
export function privacyNotice(kind: ConnectionKind, baseUrl: string) {
  if (kind === "openai") return "Sent to OpenAI";
  if (kind === "openrouter") return "Sent to OpenRouter and the model's host";
  if (isLocalUrl(baseUrl)) return "Stays on your machine";
  try { return `Sent to ${new URL(baseUrl).host}`; } catch { return "Sent to the configured server"; }
}

/** A model connection id in requests: a saved connection's uuid or a legacy .env name. Existence is checked on use. */
export const providerIdSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/i, "Unknown model connection.");
