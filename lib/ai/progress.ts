export type AgentProgress = {
  jobResult?: import("../pipeline/types").PipelineJob;
  cached?: number;
  screening?: import("./job-screening").ScreeningProgress;
  phase: "screening" | "profiling" | "searching" | "shortlisting" | "scoring" | "rewriting" | "validating" | "repairing" | "saving";
  message: string;
  fetched?: number;
  scored?: number;
  failed?: number;
  total?: number;
  jobPostingId?: string;
};

export type ReportAgentProgress = (progress: AgentProgress) => Promise<void>;
