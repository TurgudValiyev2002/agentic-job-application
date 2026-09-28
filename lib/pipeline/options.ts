import { z } from "zod";

export const DEFAULT_MAX_MATCHES = 3;
export const maxMatchesOptions = [1, 3, 5, 10, 20] as const;
export const maxMatchesSchema = z.number().int().min(1).max(20).default(DEFAULT_MAX_MATCHES);

/** Wait before each automatic retry of a failed run; the last delay repeats if PIPELINE_MAX_RETRIES is higher. */
export const RETRY_DELAYS_MINUTES = [1, 5, 15, 30, 60] as const;

export function maxPipelineRetries() {
  const parsed = Number(process.env.PIPELINE_MAX_RETRIES);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : RETRY_DELAYS_MINUTES.length;
}

/** Minutes to wait before retry number `retry` (1-based). */
export function retryDelayMinutes(retry: number) {
  return RETRY_DELAYS_MINUTES[Math.min(Math.max(retry, 1), RETRY_DELAYS_MINUTES.length) - 1];
}
