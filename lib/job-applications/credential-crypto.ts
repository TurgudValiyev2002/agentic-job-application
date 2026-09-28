import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * ACCOUNT_CREDENTIALS_KEY wins. Without it, docker-compose names a key file in its own volume: the first
 * container to need it generates a random key there, so a fresh machine works without setup and every
 * container shares the key. Outside Docker nothing is generated.
 */
function configuredKey() {
  const value = process.env.ACCOUNT_CREDENTIALS_KEY?.trim();
  const file = process.env.ACCOUNT_CREDENTIALS_KEY_FILE?.trim();
  if (value || !file) return value ?? "";
  try { return readFileSync(file, "utf8").trim(); } catch { /* not generated yet */ }
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    // "wx" fails if another container created it first; that key is then read below.
    writeFileSync(file, `${randomBytes(32).toString("base64")}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") return "";
  }
  return readFileSync(file, "utf8").trim();
}

function encryptionKey() {
  const value = configuredKey();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error("Account credential encryption is not configured.");
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("Account credential encryption is not configured.");
  return key;
}

// `scope` binds the ciphertext to the row it belongs to, so it cannot be moved between rows.
export function encryptCredentials(value: string, scope: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`orch-account:${scope}:v1`));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptCredentials(value: string, scope: string) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Invalid encrypted account.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(parts[1], "base64"));
  decipher.setAAD(Buffer.from(`orch-account:${scope}:v1`));
  decipher.setAuthTag(Buffer.from(parts[2], "base64"));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64")), decipher.final()]).toString("utf8");
}
