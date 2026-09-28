import type { Metadata } from "next";
import { ApplicationPanel } from "../_components/application-panel";
import { PageHeader } from "../_components/ui";
import { IndeedHistory } from "../_components/indeed-history";
export const metadata: Metadata = { title: "Job applications" };
export default async function JobApplicationsPage({ searchParams }: { searchParams: Promise<{ rewrite?: string; id?: string }> }) {
  const params = await searchParams;
  return <main className="flex-1 px-4 py-10 sm:px-6 sm:py-14">
    <div className="mx-auto max-w-4xl">
      <PageHeader eyebrow="Applications" title="Your applications" />
      {params.rewrite || params.id ? <ApplicationPanel rewriteId={params.rewrite} applicationId={params.id} /> : <>
        <div className="mt-8"><ApplicationPanel /></div>
        <details className="mt-10 border-t border-zinc-200 pt-5 dark:border-zinc-800"><summary className="cursor-pointer text-sm font-semibold text-zinc-900 dark:text-zinc-100">Indeed account history</summary><IndeedHistory showSession={false} /></details>
      </>}
    </div>
  </main>;
}
