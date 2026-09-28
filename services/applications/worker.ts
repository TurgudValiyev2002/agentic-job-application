import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
// A stray rejected promise (for example a browser that closed underneath a Playwright call) must not take the
// whole worker down; the run keeps its lease and the loop reports the error instead.
process.on("unhandledRejection", (reason) => { console.error("Unhandled rejection:", reason instanceof Error ? reason.message : reason); });

async function main() {
  const { ApplicationWorker } = await import("../../lib/job-applications/worker");
  const worker = new ApplicationWorker(randomUUID());
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  await worker.heartbeat();
  const timer = setInterval(() => { void worker.heartbeat().catch((error) => console.error("Application worker heartbeat:", error.message)); }, 10_000);
  console.log("Application worker ready. Indeed Apply and Lever forms open in a visible local browser; automatic runs save a draft on Indeed and never submit; manual preparations require review in the app.");
  try {
    while (!stopping) {
      try { await worker.tick(); } catch (error) { console.error("Application worker:", error instanceof Error ? error.message : error); }
      if (process.argv.includes("--once")) break;
      await delay(1000);
    }
  } finally { clearInterval(timer); await worker.stop(); }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error.message); process.exit(1); });
