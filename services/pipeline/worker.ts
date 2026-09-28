import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

// A stray rejected promise (for example a browser that closed underneath a Playwright call) must not take the
// whole worker down; the run keeps its lease and the loop reports the error instead.
process.on("unhandledRejection", (reason) => { console.error("Unhandled rejection:", reason instanceof Error ? reason.message : reason); });

async function main() {
  // Load configuration before importing the shared DB and application agents.
  const { processNextPipeline } = await import("../../lib/pipeline/service");
  const { processNextProfileJob } = await import("../../lib/cv/profile-jobs");
  const { heartbeatWorker } = await import("../../lib/pipeline/store");
  const { startDueScheduledRun } = await import("../../lib/pipeline/schedule");
  const workerId = randomUUID();
  let stopping = false;
  process.on("SIGINT", () => { stopping = true; });
  process.on("SIGTERM", () => { stopping = true; });
  const heartbeat = () => heartbeatWorker(workerId).catch((error) => console.error("Pipeline worker heartbeat failed:", error.message));
  await heartbeat();
  const timer = setInterval(() => { void heartbeat(); }, 15_000);
  console.log(`Pipeline worker ${workerId} ready. Waiting for CV → jobs → tailoring runs.`);
  // The saved daily run is checked once a minute; the worker then picks it up like any queued run.
  let scheduleCheckedAt = 0;
  const checkSchedule = async () => {
    if (Date.now() - scheduleCheckedAt < 60_000) return;
    scheduleCheckedAt = Date.now();
    try {
      const runId = await startDueScheduledRun();
      if (runId) console.log(`Started the daily pipeline run ${runId}.`);
    } catch (error) { console.error("Daily run check failed:", error instanceof Error ? error.message : error); }
  };
  try {
    do {
      try {
        await checkSchedule();
        const worked = await processNextPipeline() || await processNextProfileJob();
        if (process.argv.includes("--once")) break;
        if (!worked && !stopping) await delay(2_000);
      } catch (error) {
        console.error("Pipeline worker error:", error instanceof Error ? error.message : error);
        if (process.argv.includes("--once")) throw error;
        if (!stopping) await delay(5_000);
      }
    } while (!stopping);
  } finally {
    clearInterval(timer);
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
