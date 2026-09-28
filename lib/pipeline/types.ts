import type { SearchPreferences } from "../jobs/preferences";
import type { SearchPlan } from "../jobs/search-plan";
import type { JobAssessment } from "../jobs/assessment";
import type { AiProviderName } from "../ai/provider-ui";
import type { CvContent } from "../cv/content";
import type { AgentProgress } from "../ai/progress";

export type PipelineStatus = "queued" | "running" | "completed" | "partial" | "failed";
export type PipelineJob = {
  jobPostingId: string;
  title: string;
  company: string;
  source?: string;
  location: string | null;
  url: string;
  description: string;
  suitable?: boolean;
  /** Whether the Indeed posting offers Indeed's own application form; absent for other sources or older runs. */
  indeedApply?: boolean;
  assessment?: JobAssessment;
  score: number;
  similarity: number;
  missing: string[];
  rationale: string;
  status: "pending" | "running" | "completed" | "failed";
  rewriteId?: string;
  applicationId?: string;
  applicationError?: string;
  applicationStatus?: import("../job-applications/types").ApplicationStatus;
  /** How often the fact-checks rejected this job's CV; drives the strict → lenient → profile-CV escalation. */
  tailorRejections?: number;
  /** Set when the CV was not tailored strictly: "lenient" removed unverifiable lines, "profile" is the profile's own CV. */
  tailoring?: import("./tailoring").Tailoring;
  applicationMessage?: string | null;
  error?: string;
};

export type PipelineState = {
  profileId?: string;
  profileName?: string;
  /** Missing in older runs, which retain the original top-three limit. */
  maxMatches?: number;
  autoApply?: boolean;
  screening?: import("../ai/job-screening").ScreeningProgress;
  preferences?: SearchPreferences;
  searchRound?: number;
  searchPlan?: SearchPlan;
  previousPlans?: string[];
  assessedIds?: string[];
  consideredTotal?: number;
  rankedJobs?: PipelineJob[];
  stage: "finding" | "ranking" | "tailoring" | "applying" | "done";
  search?: { jobPostingIds: string[]; fetched: number; warnings: string[] };
  matching?: { considered: number; scored: number; failed: number; ranking: string };
  jobs: PipelineJob[];
  warnings: string[];
  // Optional for runs saved before live progress was introduced.
  startedAt?: string;
  live?: AgentProgress & { at: string };
  fetched?: number;
  scoring?: { scored: number; failed: number; total: number; cached?: number };
  activity?: Array<{ at: string; stage: PipelineState["stage"]; message: string }>;
  /** Started by the saved daily run rather than by hand. */
  scheduled?: boolean;
};

export type PipelineInput = {
  maxMatches?: number;
  id: string;
  cvDocumentId: string;
  provider: AiProviderName;
  model: string;
  preferences?: SearchPreferences;
  /** Mirrors the run state's persisted choice so discovery can restrict itself to postings the worker can apply to. */
  autoApply?: boolean;
  /** The chosen CV profile, so its target role can lead the job search. */
  profileId?: string;
};

export type PipelineRunView = PipelineInput & {
  filename: string;
  status: PipelineStatus;
  state: PipelineState;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  workerActive: boolean;
  /** Failed attempts sent back to the queue so far, out of `maxRetries`. */
  retries: number;
  maxRetries: number;
  /** Set while the run waits (status `queued`) for its next retry. */
  retryAt: string | null;
  results: Array<{ rewriteId: string; content: CvContent }>;
};

export function initialPipelineState(): PipelineState {
  return { stage: "finding", jobs: [], warnings: [] };
}

export function pipelineIsActive(status: PipelineStatus) {
  return status === "queued" || status === "running";
}
