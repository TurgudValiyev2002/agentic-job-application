import "server-only";

import { Agent } from "undici";

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Node's built-in fetch abandons a request whose response has not started within
 * five minutes, whatever the caller's own timeout says. A large model on a slow
 * server routinely takes longer than that to produce a non-streamed reply, so model
 * requests use a dispatcher whose header and body limits follow the caller's timeout.
 */
const dispatchers = new Map<number, Agent>();
function longRequestDispatcher(timeoutMs: number) {
  let agent = dispatchers.get(timeoutMs);
  if (!agent) {
    agent = new Agent({ headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
    dispatchers.set(timeoutMs, agent);
  }
  return agent;
}

/** fetch whose transport limits match the caller's timeout instead of Node's five-minute default. */
export function longFetch(url: string, init: RequestInit, timeoutMs: number) {
  // The DOM RequestInit type does not know Node's dispatcher option.
  return fetch(url, { ...init, dispatcher: longRequestDispatcher(timeoutMs) } as RequestInit);
}

/** The transport-level reason a fetch threw, for example "ECONNRESET" or "other side closed". */
export function fetchFailureReason(error: unknown) {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error instanceof Error ? error : null;
  if (!cause) return "unknown error";
  const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;
  return code ? `${code}${cause.message && cause.message !== code ? `: ${cause.message}` : ""}` : cause.message || cause.name;
}

/** Idempotent model requests are re-sent once after a dropped connection; timeouts and HTTP errors are not retried. */
export const TRANSPORT_RETRY_DELAY_MS = positiveInteger(process.env.AI_TRANSPORT_RETRY_DELAY_MS, 5_000);
