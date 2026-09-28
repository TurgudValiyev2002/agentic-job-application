import "server-only";

import { gt, isNull, sql } from "drizzle-orm";
import { applications, db, indeedSessions, pipelineRuns, pipelineWorkers } from "@/lib/db";
import { savedConnections } from "@/lib/ai/connections";
import { workerActive } from "@/lib/job-applications/store";

export type SetupStep = { id: string; title: string; detail: string; href?: string; action?: string; command?: string; done: boolean };

/** What a first-time user still has to do before the pipeline can run, checked against the real state. */
export async function setupSteps(): Promise<SetupStep[]> {
  const [connections, profiles, [pipelineWorker], applicationsWorker, [session], [run]] = await Promise.all([
    savedConnections(),
    db.select({ status: applications.cvStatus }).from(applications).where(isNull(applications.archivedAt)),
    db.select({ id: pipelineWorkers.id }).from(pipelineWorkers).where(gt(pipelineWorkers.lastSeenAt, sql`now() - interval '45 seconds'`)).limit(1),
    workerActive(),
    db.select({ id: indeedSessions.id }).from(indeedSessions).limit(1),
    db.select({ id: pipelineRuns.id }).from(pipelineRuns).limit(1),
  ]);
  const ready = profiles.some((profile) => profile.status === "ready");
  const busy = profiles.find((profile) => ["generating", "improving", "reviewing"].includes(profile.status));
  return [
    { id: "model", title: "Choose a model", detail: "Ollama, LM Studio, an API link, or an API key.", href: "/settings", action: "Add a model",
      done: connections.some((connection) => connection.available) || Boolean(process.env.AI_PROVIDER?.trim()) },
    { id: "details", title: "Add your details", detail: "Your experience and the role you want.", href: "/apply", action: "Add details", done: profiles.length > 0 },
    { id: "cv", title: "Get a ready CV", detail: busy ? `Your CV is ${busy.status}…` : "Created automatically when you save your details.", href: "/apply", action: "View profiles", done: ready },
    { id: "workers", title: "Start the workers", detail: "They run searches and applications in the background.", command: "npm run dev:all",
      done: Boolean(pipelineWorker) && applicationsWorker },
    { id: "indeed", title: "Sign in to Indeed", detail: "Used to search and save drafts.", href: "/pipeline", action: "Sign in", done: Boolean(session) },
    { id: "run", title: "Start your first run", detail: "Pick your profile and preferences.", href: "/pipeline", action: "Open pipeline", done: Boolean(run) },
  ];
}
