import "server-only";

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const LATEX_IMAGE = "orch-latex:slim";
const DEFAULT_TIMEOUT_MS = 60_000;
const LOG_TAIL_LINES = 40;
const MAX_PROCESS_OUTPUT_BYTES = 2 * 1024 * 1024;

export type LatexCompileErrorCode =
  | "docker_unavailable"
  | "image_missing"
  | "timeout"
  | "compile_failed";

export class LatexCompileError extends Error {
  readonly code: LatexCompileErrorCode;
  readonly logTail?: string;

  constructor(
    code: LatexCompileErrorCode,
    message: string,
    options?: { cause?: unknown; logTail?: string },
  ) {
    super(
      message,
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "LatexCompileError";
    this.code = code;
    this.logTail = options?.logTail;
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function execFileResult(
  file: string,
  args: readonly string[],
  options: { timeout?: number } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      file,
      [...args],
      {
        encoding: "utf8",
        maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
        ...options,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

function isExecutableMissing(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function assertLatexImageExists() {
  try {
    await execFileResult("docker", ["image", "inspect", LATEX_IMAGE], {
      timeout: 10_000,
    });
  } catch (error) {
    if (isExecutableMissing(error)) {
      throw new LatexCompileError(
        "docker_unavailable",
        "Docker is unavailable. Install or start Docker, then retry the PDF download.",
        { cause: error },
      );
    }

    const output =
      typeof error === "object" && error !== null && "stderr" in error
        ? String(error.stderr)
        : "";
    if (/no such image|no such object/i.test(output)) {
      throw new LatexCompileError(
        "image_missing",
        `The ${LATEX_IMAGE} image is missing. Build it once with \`npm run latex:build\` (docker build -t ${LATEX_IMAGE} docker/latex).`,
        { cause: error },
      );
    }

    throw new LatexCompileError(
      "docker_unavailable",
      "Docker could not inspect the LaTeX image. Make sure Docker is running, then retry.",
      { cause: error },
    );
  }
}

async function logTail(workDirectory: string) {
  try {
    const log = await readFile(path.join(workDirectory, "cv.log"), "utf8");
    return log.split(/\r?\n/).slice(-LOG_TAIL_LINES).join("\n").trim();
  } catch {
    return undefined;
  }
}

function logRequestsRerun(log: string) {
  return /Rerun to get|Label\(s\) may have changed|(?:hyperref|rerunfilecheck).*rerun/i.test(
    log,
  );
}

// Inside the Docker image TeX Live is installed next to the app, so pdflatex runs directly instead of
// through a sibling sandbox container (which would need the host's Docker socket).
function usesLocalPdfLatex() {
  return process.env.LATEX_RUNNER === "local";
}

async function runLocalPdfLatex(workDirectory: string, timeoutMs: number) {
  try {
    await new Promise<void>((resolve, reject) => {
      execFile(
        "pdflatex",
        ["-no-shell-escape", "-interaction=nonstopmode", "-halt-on-error", "cv.tex"],
        { cwd: workDirectory, encoding: "utf8", maxBuffer: MAX_PROCESS_OUTPUT_BYTES, timeout: timeoutMs, killSignal: "SIGKILL" },
        (error) => (error ? reject(error) : resolve()),
      );
    });
  } catch (error) {
    if (isExecutableMissing(error)) {
      throw new LatexCompileError("docker_unavailable", "pdflatex is not installed in this environment.", { cause: error });
    }
    if (typeof error === "object" && error !== null && "killed" in error && error.killed) {
      throw new LatexCompileError(
        "timeout",
        `LaTeX compilation exceeded the ${timeoutMs} ms timeout. The process was stopped; retry the PDF download.`,
        { cause: error },
      );
    }
    throw error;
  }
}

async function runPdfLatex(workDirectory: string, timeoutMs: number) {
  if (usesLocalPdfLatex()) return runLocalPdfLatex(workDirectory, timeoutMs);
  const containerName = `orch-latex-${randomUUID()}`;
  const args = [
    "run",
    "--rm",
    "--name",
    containerName,
    "--network",
    "none",
    "-v",
    `${workDirectory}:/work`,
    LATEX_IMAGE,
    "pdflatex",
    "-no-shell-escape",
    "-interaction=nonstopmode",
    "-halt-on-error",
    "cv.tex",
  ];

  await new Promise<void>((resolve, reject) => {
    let timedOut = false;
    let timeoutCleanup: Promise<void> | undefined;
    const child = execFile(
      "docker",
      args,
      { encoding: "utf8", maxBuffer: MAX_PROCESS_OUTPUT_BYTES },
      async (error) => {
        clearTimeout(timeout);
        if (timedOut) {
          await timeoutCleanup;
          reject(
            new LatexCompileError(
              "timeout",
              `LaTeX compilation exceeded the ${timeoutMs} ms timeout. The container was stopped; retry the PDF download.`,
              { cause: error },
            ),
          );
          return;
        }
        if (error) {
          reject(error);
          return;
        }
        resolve();
      },
    );

    const timeout = setTimeout(() => {
      timedOut = true;
      timeoutCleanup = (async () => {
        try {
          await execFileResult("docker", ["kill", containerName], {
            timeout: 5_000,
          });
        } catch {
          try {
            await execFileResult("docker", ["rm", "-f", containerName], {
              timeout: 5_000,
            });
          } catch {
            // The container may already have exited and removed itself.
          }
        } finally {
          child.kill("SIGKILL");
        }
      })();
    }, timeoutMs);
  });
}

export async function compileLatexToPdf(
  latex: string,
  options: { timeoutMs?: number } = {},
) {
  const workDirectory = await mkdtemp(path.join(tmpdir(), "orch-latex-"));
  const timeoutMs =
    options.timeoutMs ??
    positiveInteger(process.env.LATEX_COMPILE_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const deadline = Date.now() + timeoutMs;

  try {
    await writeFile(path.join(workDirectory, "cv.tex"), latex, "utf8");
    if (!usesLocalPdfLatex()) await assertLatexImageExists();

    try {
      await runPdfLatex(workDirectory, Math.max(1, deadline - Date.now()));
      const firstLog = await readFile(path.join(workDirectory, "cv.log"), "utf8");
      if (logRequestsRerun(firstLog)) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
          throw new LatexCompileError(
            "timeout",
            `LaTeX compilation exceeded the ${timeoutMs} ms timeout. The container was stopped; retry the PDF download.`,
          );
        }
        await runPdfLatex(workDirectory, remainingMs);
      }
    } catch (error) {
      if (error instanceof LatexCompileError) {
        const tail = error.logTail ?? (await logTail(workDirectory));
        if (!tail || error.logTail) throw error;
        throw new LatexCompileError(
          error.code,
          `${error.message}\nLog tail:\n${tail}`,
          { cause: error, logTail: tail },
        );
      }

      const tail = await logTail(workDirectory);
      throw new LatexCompileError(
        "compile_failed",
        tail
          ? `LaTeX compilation failed. Log tail:\n${tail}`
          : "LaTeX compilation failed before a diagnostic log was produced.",
        { cause: error, logTail: tail },
      );
    }

    try {
      return new Uint8Array(await readFile(path.join(workDirectory, "cv.pdf")));
    } catch (error) {
      const tail = await logTail(workDirectory);
      throw new LatexCompileError(
        "compile_failed",
        tail
          ? `LaTeX did not produce a readable PDF. Log tail:\n${tail}`
          : "LaTeX did not produce a readable PDF or diagnostic log.",
        { cause: error, logTail: tail },
      );
    }
  } finally {
    await rm(workDirectory, { recursive: true, force: true });
  }
}
