import "server-only";
import { and, eq } from "drizzle-orm";
import { db, indeedSessions, INDEED_SESSION_ID } from "../db";
import { loadIndeedSession } from "./session";
import { historySnapshotSchema, type IndeedHistoryView } from "./history-data";
import { readIndeedHistory } from "./history-reader";
import { signInProgress } from "./sign-in";

export async function indeedHistoryView(): Promise<IndeedHistoryView> {
  const [row] = await db.select({ emailHint: indeedSessions.emailHint, snapshot: indeedSessions.applicationHistory }).from(indeedSessions).where(eq(indeedSessions.id, INDEED_SESSION_ID));
  const parsed = historySnapshotSchema.safeParse(row?.snapshot);
  return { saved: Boolean(row), emailHint: row?.emailHint ?? null, snapshot: parsed.success ? parsed.data : null };
}
export async function syncIndeedHistory(read = readIndeedHistory) {
  if (signInProgress().active) throw new Error("Finish the Indeed sign-in window before syncing applications.");
  const session = await loadIndeedSession();
  if (!session) throw new Error("Sign in to Indeed before syncing applications.");
  const snapshot = historySnapshotSchema.parse(await read(session.state));
  // A late result must never be attached to another account or recreate a removed session.
  const rows = await db.update(indeedSessions).set({ applicationHistory: snapshot }).where(and(eq(indeedSessions.id, INDEED_SESSION_ID), eq(indeedSessions.encryptedState, session.version))).returning({ id: indeedSessions.id });
  if (!rows.length) throw new Error("The Indeed session changed during sync. Sync again using the current account.");
  return indeedHistoryView();
}
