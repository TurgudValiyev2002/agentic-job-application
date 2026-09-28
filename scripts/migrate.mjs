// Applies the committed Drizzle migrations in ./drizzle. Used by the Docker `migrate` service so the
// runtime image does not need drizzle-kit; it records progress in the same table `npm run db:migrate` uses.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set.");

const client = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} finally {
  await client.end();
}
