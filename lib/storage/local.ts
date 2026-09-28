import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile as readFsFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const allowedExtensions = new Set([".pdf", ".docx", ".txt", ".md"]);

function uploadRoot() {
  return path.resolve(
    /* turbopackIgnore: true */ process.cwd(),
    process.env.CV_UPLOAD_DIR || ".uploads",
  );
}

function validatedExtension(ext: string) {
  const normalized = ext.toLowerCase();

  if (
    ext !== normalized ||
    ext.includes("/") ||
    ext.includes("\\") ||
    ext.includes("..") ||
    !allowedExtensions.has(normalized)
  ) {
    throw new Error("Invalid CV file extension.");
  }

  return normalized;
}

function resolveInsideRoot(storagePath: string) {
  const root = uploadRoot();
  const resolved = path.resolve(/* turbopackIgnore: true */ root, storagePath);
  const relative = path.relative(root, resolved);

  if (
    !relative ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    storagePath.includes("/") ||
    storagePath.includes("\\")
  ) {
    throw new Error("Invalid CV storage path.");
  }

  return { root, resolved };
}

export async function saveFile(bytes: Uint8Array, ext: string) {
  const filename = `${randomUUID()}${validatedExtension(ext)}`;
  const { root, resolved } = resolveInsideRoot(filename);

  await mkdir(root, { recursive: true });
  await writeFile(resolved, bytes, { flag: "wx" });

  return filename;
}

export async function readFile(storagePath: string) {
  const { resolved } = resolveInsideRoot(storagePath);
  return readFsFile(/* turbopackIgnore: true */ resolved);
}

export async function deleteFile(storagePath: string) {
  const { resolved } = resolveInsideRoot(storagePath);

  try {
    await unlink(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
