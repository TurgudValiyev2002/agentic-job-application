import { indeedJobUrl } from "../jobs/sources/indeed-data";

/** Only public Lever hosted job forms are supported. Strip tracking parameters. */
export function leverApplicationUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !["jobs.lever.co", "jobs.eu.lever.co"].includes(url.hostname)) return null;
    const match = url.pathname.match(/^\/([a-zA-Z0-9_-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/apply)?\/?$/i);
    return match ? `${url.origin}/${match[1]}/${match[2].toLowerCase()}/apply` : null;
  } catch { return null; }
}

/** The application URL for a job link: a Lever form or an Indeed posting. Other hosts are never fetched. */
export function resolveApplicationUrl(value: string): string | null {
  return leverApplicationUrl(value) ?? indeedJobUrl(value);
}
