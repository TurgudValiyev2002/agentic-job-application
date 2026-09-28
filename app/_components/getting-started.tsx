import Link from "next/link";
import type { SetupStep } from "@/lib/onboarding";
import { cardClass } from "./ui";

export function GettingStarted({ steps }: { steps: SetupStep[] }) {
  const done = steps.filter((step) => step.done).length;
  const complete = done === steps.length;
  const next = steps.find((step) => !step.done)?.id;

  // Open while something is left to do; a one-line summary once everything is set up.
  return <details open={!complete} aria-label="Get started" className={`group ${cardClass} mt-8 overflow-hidden`}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 marker:hidden sm:px-6">
      <h2 className="text-base font-semibold text-zinc-950 dark:text-white">{complete ? "Setup" : "Get started"}</h2>
      <span className={`text-sm tabular-nums ${complete ? "font-semibold text-emerald-700 dark:text-emerald-400" : "text-zinc-500 dark:text-zinc-400"}`}>{done} of {steps.length}{complete ? " ✓" : ""}</span>
    </summary>
    <div className="h-1 bg-zinc-100 dark:bg-zinc-800"><div className="h-full bg-emerald-500" style={{ width: `${(done / steps.length) * 100}%` }} /></div>
    <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {steps.map((step, index) => {
        const current = step.id === next;
        return <li key={step.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 sm:px-6 ${current ? "bg-blue-50/60 dark:bg-blue-950/20" : ""}`}>
          <span aria-hidden="true" className={`flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? "bg-emerald-500 text-white" : current ? "bg-blue-700 text-white dark:bg-blue-600" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{step.done ? "✓" : index + 1}</span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${step.done ? "text-zinc-500 line-through decoration-zinc-300 dark:text-zinc-500" : "text-zinc-950 dark:text-white"}`}>{step.title}<span className="sr-only">{step.done ? " (done)" : ""}</span></p>
            {!step.done && <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">{step.detail}</p>}
          </div>
          {!step.done && step.command && <code className="rounded-md bg-zinc-100 px-2 py-1 font-mono text-xs text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">{step.command}</code>}
          {!step.done && step.href && <Link href={step.href} className={`shrink-0 text-sm font-semibold ${current ? "text-blue-700 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-400"} hover:underline`}>{step.action} <span aria-hidden="true">→</span></Link>}
        </li>;
      })}
    </ol>
  </details>;
}
