import type { Metadata } from "next";
import { connection } from "next/server";
import { ModelConnections } from "@/app/_components/model-connections";
import { envConnections, savedConnections, withoutSecret } from "@/lib/ai/connections";
import { defaultAiProviderName } from "@/lib/ai/provider";

export const metadata: Metadata = { title: "Models", description: "Choose where the AI runs: Ollama, LM Studio, an API link, or a platform key." };

export default async function SettingsPage() {
  await connection();
  let envDefault = "lmstudio";
  try { envDefault = defaultAiProviderName(); } catch { /* shown as unavailable in the pickers */ }
  const [saved, env] = [await savedConnections(), envConnections()];
  return (
    <main className="flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-4xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">Settings</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">Where the AI runs</h1>
        <ModelConnections initial={saved.map(withoutSecret)} env={env.map(withoutSecret)} envDefault={envDefault} />
      </div>
    </main>
  );
}
