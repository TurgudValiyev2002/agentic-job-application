import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { cardClass } from "@/app/_components/ui";
import { GettingStarted } from "@/app/_components/getting-started";
import { setupSteps } from "@/lib/onboarding";

export const metadata: Metadata = {
  title: "Orchestrator",
  description: "Job applications and CV feedback.",
};

export default async function HomePage() {
  await connection();
  const setup = await setupSteps();
  const steps: Array<{ href: string; step: string; title: string; description: string; affordance: string; featured?: boolean }> = [
    { href: "/apply", step: "1", title: "Your profiles", description: "Your details, a target role and a reviewed CV.", affordance: "Open profiles" },
    { href: "/cv-review", step: "2", title: "Review your CV", description: "AI feedback on your CV.", affordance: "Open CV reviewer" },
    { href: "/pipeline", step: "3", title: "Run the pipeline", description: "Find jobs, tailor CVs, save drafts.", affordance: "Start a run", featured: true },
    { href: "/job-applications", step: "4", title: "Applications", description: "Progress, drafts and what needs you.", affordance: "Open applications" },
  ];

  return (
    <main className="flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-5xl">
        <header className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-700 dark:text-blue-300">Orchestrator</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 dark:text-white sm:text-4xl">From one CV to tailored applications</h1>
        </header>

        <GettingStarted steps={setup} />

        <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map((item) => (
            <li key={item.href} className={item.featured ? "sm:col-span-2 lg:col-span-1" : ""}>
              <Link href={item.href}
                className={`group flex h-full flex-col p-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950 sm:p-6 ${cardClass} ${item.featured ? "border-blue-300 bg-blue-50/50 hover:border-blue-400 dark:border-blue-800 dark:bg-blue-950/20 dark:hover:border-blue-700" : "hover:border-zinc-300 hover:bg-zinc-50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"}`}>
                <span className="flex items-center gap-3">
                  <span aria-hidden="true" className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${item.featured ? "bg-blue-700 text-white dark:bg-blue-600" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}>{item.step}</span>
                  <span className="text-base font-semibold text-zinc-950 dark:text-white">{item.title}</span>
                </span>
                <span className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{item.description}</span>
                <span className="mt-auto pt-5 text-sm font-semibold text-blue-700 group-hover:underline dark:text-blue-300">{item.affordance} <span aria-hidden="true">→</span></span>
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}
