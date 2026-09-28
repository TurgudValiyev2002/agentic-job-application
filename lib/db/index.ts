import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is not set. Create .env.local from .env.example and provide a Postgres connection URL.",
  );
}

const globalForDatabase = globalThis as typeof globalThis & {
  orchPostgresClient?: ReturnType<typeof postgres>;
};

// Keep the pool bounded for development and serverless-style runtimes.
const client =
  process.env.NODE_ENV === "production"
    ? postgres(databaseUrl, { max: 10 })
    : (globalForDatabase.orchPostgresClient ??=
        postgres(databaseUrl, { max: 10 }));

export const db = drizzle(client, { schema });

export * from "./schema";
