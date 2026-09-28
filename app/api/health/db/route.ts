import { sql } from "drizzle-orm";

import { db } from "@/lib/db";

export async function GET() {
  try {
    await db.execute(sql`select 1`);

    return Response.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "An unknown database error occurred";
    const databaseUrl = process.env.DATABASE_URL;
    const safeMessage = databaseUrl
      ? message.replaceAll(databaseUrl, "[redacted]")
      : message;

    return Response.json({ ok: false, error: safeMessage }, { status: 500 });
  }
}
