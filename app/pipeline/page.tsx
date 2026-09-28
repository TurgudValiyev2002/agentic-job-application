import type { Metadata } from "next";
import { connection } from "next/server";
import { z } from "zod";
import { PipelinePanel } from "@/app/_components/pipeline-panel";
import { defaultProviderId, selectableAiProviders } from "@/lib/ai/provider";
import { maxCvBytes } from "@/lib/config";
import { listProfiles } from "@/lib/db/queries";
import { defaultJobMaxAgeDays } from "@/lib/jobs/sources/indeed-data";
import { getPipelineRun, recentPipelineRuns } from "@/lib/pipeline/store";
import { getSchedule } from "@/lib/pipeline/schedule";

export const metadata: Metadata = { title: "CV pipeline", description: "Upload a CV, find jobs, tailor your top matches, and save drafts on Indeed." };

export default async function PipelinePage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  await connection();
  const { run } = await searchParams;
  const [runs, profiles, schedule, providers, defaultProvider] = await Promise.all([recentPipelineRuns(), listProfiles(), getSchedule(), selectableAiProviders(), defaultProviderId()]);
  if (run && z.uuid().safeParse(run).success && !runs.some((item) => item.id === run)) {
    const selected = await getPipelineRun(run);
    if (selected) runs.unshift(selected);
  }
  return (
    <main className="flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto max-w-5xl">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">CV pipeline</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white">One CV. Find your strongest matches.</h1>
        <PipelinePanel maxBytes={maxCvBytes()} providers={providers} defaultProvider={defaultProvider} initialRuns={runs} initialRunId={run} initialProfiles={profiles.map(profile => ({ ...profile, updatedAt: profile.updatedAt.toISOString(), selectedAt: profile.selectedAt?.toISOString() ?? null, archivedAt: profile.archivedAt?.toISOString() ?? null }))} defaultMaxAgeDays={defaultJobMaxAgeDays()} initialSchedule={schedule} />
      </div>
    </main>
  );
}
