import type { SearchPlan } from "./search-plan";
import type { ReportAgentProgress } from "../ai/progress";
import type { JobSearchSpec } from "./preferences";
import type { ActiveAiProvider } from "@/lib/ai/provider";

export type NormalizedJob = {
  source: string;
  externalId: string;
  company: string;
  title: string;
  location: string | null;
  remote: boolean;
  url: string;
  description: string | null;
  postedAt: Date | null;
  raw: unknown;
};

export type JobSource = {
  name: string;
  available(): boolean;
  search(profile: JobSearchSpec, onProgress?: ReportAgentProgress, plan?: SearchPlan, provider?: ActiveAiProvider): Promise<NormalizedJob[]>;
};
