import "server-only";

import type { JobSource } from "@/lib/jobs/types";

import { indeedSource } from "./indeed";

let testSources: JobSource[] | null = null;
/** Integration tests search a synthetic source instead of Indeed; `null` restores the configured sources. */
export function setTestJobSources(sources: JobSource[] | null) {
  testSources = sources;
}

export function jobSources(): JobSource[] {
  if (testSources) return testSources;
  const enabled = (process.env.JOB_SOURCES ?? "indeed").split(",").map((name) => name.trim());
  return [indeedSource].filter((source) => enabled.includes(source.name));
}
