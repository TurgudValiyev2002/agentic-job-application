// Runs the web app and both background workers as one supervised group.
//
// The pipeline and application workers are separate Node processes; when they
// are started by hand they quietly die with whatever terminal spawned them and
// every new run then waits forever for a worker. This script keeps them
// together: output is prefixed per process, a crashed worker is restarted, and
// stopping the group (Ctrl-C, or the web app exiting) stops everything.
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const RESTART_DELAY_MS = 3_000;
const processes = [
  { name: "web", script: "dev", restart: false },
  { name: "pipeline", script: "pipeline:worker", restart: true },
  { name: "applications", script: "applications:worker", restart: true },
];
const colors = { web: "\x1b[36m", pipeline: "\x1b[35m", applications: "\x1b[33m" };
const width = Math.max(...processes.map((item) => item.name.length));
const children = new Map();
let stopping = false;

function log(name, chunk, stream) {
  const prefix = `${colors[name]}${name.padEnd(width)}\x1b[0m │ `;
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.length) stream.write(`${prefix}${line}\n`);
  }
}

function stopAll(signal = "SIGTERM") {
  stopping = true;
  for (const child of children.values()) child.kill(signal);
}

async function run({ name, script, restart }) {
  while (!stopping) {
    const child = spawn("npm", ["run", "--silent", script], { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    children.set(name, child);
    child.stdout.on("data", (chunk) => log(name, chunk, process.stdout));
    child.stderr.on("data", (chunk) => log(name, chunk, process.stderr));
    const code = await new Promise((resolve) => child.on("exit", (exitCode, signal) => resolve(signal ?? exitCode ?? 0)));
    children.delete(name);
    if (stopping) return;
    if (!restart) {
      process.stderr.write(`${name} exited (${code}); stopping the workers.\n`);
      stopAll();
      return;
    }
    process.stderr.write(`${name} exited (${code}); restarting in ${RESTART_DELAY_MS / 1000}s.\n`);
    await delay(RESTART_DELAY_MS);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    process.stderr.write("\nStopping the web app and workers…\n");
    stopAll(signal);
  });
}

await Promise.all(processes.map(run));
