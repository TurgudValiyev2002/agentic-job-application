"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/apply", label: "Details" },
  { href: "/cv-review", label: "CV Review" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/job-applications", label: "Applications" },
  { href: "/settings", label: "Models" },
] as const;

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex min-h-14 w-full max-w-6xl items-center justify-between gap-2 px-4 sm:px-6">
        <Link
          href="/"
          className="rounded-md py-2 text-sm font-semibold tracking-tight text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:text-white dark:focus-visible:ring-offset-zinc-950 sm:text-base"
        >
          Orchestrator
        </Link>
        <nav aria-label="Primary navigation" className="-mx-1 flex items-center gap-0.5 overflow-x-auto px-1">
          {links.map((link) => {
            const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
            return <Link key={link.href} href={link.href} aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-md px-2 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-zinc-950 sm:px-3 ${active ? "bg-zinc-100 text-zinc-950 dark:bg-zinc-800 dark:text-white" : "text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"}`}>
              {link.label}
            </Link>;
          })}
        </nav>
      </div>
    </header>
  );
}
