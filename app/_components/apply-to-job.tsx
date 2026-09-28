import Link from "next/link";
export function ApplyToJob({ rewriteId, className = "mt-4" }: { rewriteId: string; className?: string }) {
  return <Link href={`/job-applications?rewrite=${encodeURIComponent(rewriteId)}`} className={`${className} inline-flex min-h-9 items-center rounded-lg border border-blue-600 px-4 py-1.5 text-sm font-semibold text-blue-700 transition hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-blue-300 dark:hover:bg-blue-950`}>Apply with this CV</Link>;
}
