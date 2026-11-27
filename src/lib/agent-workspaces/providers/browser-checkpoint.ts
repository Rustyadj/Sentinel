import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrowserContext } from "@playwright/test";
import type { BrowserSession } from "../browser";
import { WorkspaceError } from "../errors";

export type BrowserCheckpoint = BrowserSession & {
  storageState: Awaited<ReturnType<BrowserContext["storageState"]>>;
};

function checkpointLocation(workspaceId: string) {
  const root = process.env.SENTINEL_BROWSER_STATE_DIR;
  const secret = process.env.AUTH_SECRET;
  if (!root && process.env.NODE_ENV !== "production") return null;
  if (!root || !path.isAbsolute(root) || !secret) {
    throw new WorkspaceError("Browser recovery requires a state directory and configured AUTH_SECRET.", "runtime_unavailable");
  }
  const filename = createHash("sha256").update(workspaceId).digest("hex");
  const key = Buffer.from(hkdfSync("sha256", secret, "", "sentinel-browser-checkpoint-v1", 32));
  return { root, filename: path.join(root, filename), key, scope: Buffer.from(workspaceId) };
}

export async function readBrowserCheckpoint(workspaceId: string): Promise<BrowserCheckpoint | null> {
  const location = checkpointLocation(workspaceId);
  if (!location) return null;
  try {
    const encrypted = await readFile(location.filename);
    const decipher = createDecipheriv("aes-256-gcm", location.key, encrypted.subarray(0, 12));
    decipher.setAAD(location.scope);
    decipher.setAuthTag(encrypted.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(encrypted.subarray(28)), decipher.final()]);
    return JSON.parse(plaintext.toString("utf8")) as BrowserCheckpoint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new WorkspaceError("The browser session checkpoint could not be read.", "runtime_unavailable");
  }
}

export async function writeBrowserCheckpoint(session: BrowserSession, context: BrowserContext) {
  const location = checkpointLocation(session.workspaceId);
  if (!location) return;
  const temporary = location.filename + "." + randomUUID();
  try {
    const storageState = await context.storageState({ indexedDB: true });
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", location.key, iv);
    cipher.setAAD(location.scope);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ ...session, storageState })), cipher.final()]);
    await mkdir(location.root, { recursive: true, mode: 0o700 });
    await writeFile(temporary, Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), { flag: "wx", mode: 0o600, flush: true });
    await rename(temporary, location.filename);
  } catch {
    throw new WorkspaceError("Browser session could not be checkpointed. Verify any external changes before retrying.", "runtime_unavailable");
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}

export async function deleteBrowserCheckpoint(workspaceId: string) {
  const location = checkpointLocation(workspaceId);
  if (location) await rm(location.filename, { force: true });
}
