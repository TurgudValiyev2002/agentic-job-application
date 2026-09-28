import type { ConnectionKind } from "./connection-kinds";

/** A model connection id: a saved connection's uuid, or `ollama` / `lmstudio` / `openrouter` for the .env providers. */
export type AiProviderName = string;

export type SelectableAiProvider = {
  name: AiProviderName;
  label: string;
  model: string;
  kind: ConnectionKind;
  /** Where the CV text goes, shown next to the picker. */
  privacyNotice: string;
  available: boolean;
  unavailableReason?: string;
};

export function providerUiCopy(provider: Pick<SelectableAiProvider, "label" | "privacyNotice">) {
  return {
    optionTitle: provider.label,
    privacyNotice: provider.privacyNotice,
    pageDescription: "Optional AI feedback on your CV.",
    pendingLabel: "Reviewing…",
    landingDescription: "AI feedback on your CV.",
    landingIntro: "Job applications with an AI CV reviewer.",
  };
}
