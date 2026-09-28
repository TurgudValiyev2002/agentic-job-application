import { z } from "zod";

/** A further search round: Indeed reads the next page of each title search. */
export const searchPlanSchema = z.object({
  strategy: z.enum(["next_pages"]),
  reason: z.string().trim().min(1).max(500),
}).strict();
export type SearchPlan = z.infer<typeof searchPlanSchema> & { round: number };
export const MAX_SEARCH_ROUNDS = 3;
export const MAX_PIPELINE_SCORES = 40;
