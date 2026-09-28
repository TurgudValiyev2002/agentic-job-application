import "server-only";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, indeedSessions, INDEED_SESSION_ID } from "../db";
import { decryptCredentials, encryptCredentials } from "../job-applications/credential-crypto";

// Playwright storage state, limited to Indeed cookies. Indeed signs in with an emailed one-time code, so a
// browser session captured from a manual sign-in is the only thing worth keeping; no password exists to store.
const cookieSchema = z.object({
  name: z.string(), value: z.string(), domain: z.string().regex(/(?:^|\.)indeed\.com$/), path: z.string(),
  expires: z.number(), httpOnly: z.boolean(), secure: z.boolean(), sameSite: z.enum(["Strict", "Lax", "None"]),
}).passthrough();
export const storageStateSchema = z.object({ cookies: z.array(cookieSchema), origins: z.array(z.unknown()).default([]) }).passthrough();
export type IndeedStorageState = z.infer<typeof storageStateSchema>;
const rawStateSchema = z.object({ cookies: z.array(z.unknown()).default([]) }).passthrough();

/** Keeps only Indeed cookies; a Google or Apple sign-in must not leave third-party cookies in the database. */
export function restrictToIndeed(raw: unknown): IndeedStorageState {
  const cookies = rawStateSchema.parse(raw).cookies.filter((cookie) => cookieSchema.safeParse(cookie).success);
  return storageStateSchema.parse({ cookies, origins: [] });
}

export function maskEmail(email: string | null | undefined) {
  const match = email?.trim().match(/^([^@\s]+)@([^@\s]+)$/);
  return match ? `${match[1].slice(0, 2)}***@${match[2]}` : null;
}

// A single session is kept until the user replaces or removes it; every CV applies with it.
export async function saveIndeedSession(rawState: unknown, emailHint: string | null) {
  const state = restrictToIndeed(rawState);
  if (!state.cookies.length) throw new Error("The browser session has no Indeed cookies to save.");
  const encryptedState = encryptCredentials(JSON.stringify(state), INDEED_SESSION_ID);
  await db.insert(indeedSessions).values({ id: INDEED_SESSION_ID, encryptedState, emailHint, verifiedAt: new Date() }).onConflictDoUpdate({
    target: indeedSessions.id,
    set: { encryptedState, emailHint, applicationHistory: null, verifiedAt: new Date(), updatedAt: new Date() },
  });
}

// Server-only entry point for browser workers; never return the state from an API.
export async function loadIndeedSession() {
  const [row] = await db.select().from(indeedSessions).where(eq(indeedSessions.id, INDEED_SESSION_ID)).limit(1);
  if (!row) return null;
  return { state: storageStateSchema.parse(JSON.parse(decryptCredentials(row.encryptedState, INDEED_SESSION_ID))), version: row.encryptedState, emailHint: row.emailHint, verifiedAt: row.verifiedAt };
}

export async function indeedSessionStatus() {
  const [row] = await db.select({ emailHint: indeedSessions.emailHint, verifiedAt: indeedSessions.verifiedAt }).from(indeedSessions).where(eq(indeedSessions.id, INDEED_SESSION_ID)).limit(1);
  if (!row) return { saved: false, emailHint: null, verifiedAt: null };
  return { saved: true, emailHint: row.emailHint, verifiedAt: row.verifiedAt?.toISOString() ?? null };
}

export async function removeIndeedSession() {
  await db.delete(indeedSessions).where(eq(indeedSessions.id, INDEED_SESSION_ID));
}

export async function recordIndeedVerification(version: string, success: boolean) {
  // An in-flight check cannot verify a replacement session or recreate a removed one.
  await db.update(indeedSessions).set({ verifiedAt: success ? new Date() : null })
    .where(and(eq(indeedSessions.id, INDEED_SESSION_ID), eq(indeedSessions.encryptedState, version)));
}

/** Refreshed cookies from a worker session replace the saved state only if nobody replaced or removed it meanwhile. */
export async function refreshIndeedSession(version: string, rawState: unknown) {
  const state = restrictToIndeed(rawState);
  if (!state.cookies.length) return;
  await db.update(indeedSessions).set({ encryptedState: encryptCredentials(JSON.stringify(state), INDEED_SESSION_ID), updatedAt: new Date() })
    .where(and(eq(indeedSessions.id, INDEED_SESSION_ID), eq(indeedSessions.encryptedState, version)));
}
