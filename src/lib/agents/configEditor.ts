/**
 * Secure server-side config file editor.
 * All paths are validated against AGENT_CONFIG_DIR.
 * Creates timestamped backups before overwrite.
 * Validates JSON/YAML before saving.
 */
import { readFile, writeFile, readdir, mkdir, stat } from "fs/promises";
import path from "path";
import { parseDocument } from "yaml";

const AGENT_CONFIG_DIR = process.env.AGENT_CONFIG_DIR ?? (
  process.platform === "win32" ? "C:\\ProgramData\\Sentinel OS\\agents" : "/opt/sentinel-os/agents"
);
const ALLOWED_EXTENSIONS = new Set([".md", ".json", ".yaml", ".yml"]);

export interface ConfigFile {
  id: string;
  name: string;
  ext: string;
  relativePath: string;
  size: number;
  modifiedAt: string;
}

export interface ConfigFileContent {
  id: string;
  name: string;
  ext: string;
  content: string;
  missing: boolean;
}

// ─── Path safety ──────────────────────────────────────────────────────────────

function resolvedConfigDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ AGENT_CONFIG_DIR);
}

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function safeAgentDir(agentId: string): string | null {
  // Allowlist: agent id must be alphanumeric + dash only
  if (!/^[a-z0-9-]+$/.test(agentId)) return null;
  const resolved = path.resolve(/*turbopackIgnore: true*/ AGENT_CONFIG_DIR, agentId);
  if (!isInside(resolvedConfigDir(), resolved)) return null;
  return resolved;
}

function safeFilePath(agentId: string, fileId: string): string | null {
  const agentDir = safeAgentDir(agentId);
  if (!agentDir) return null;
  // fileId is relative path segments joined by "--" (no slashes allowed)
  if (fileId.includes("/") || fileId.includes("\\") || fileId.includes("..")) return null;
  const fileName = fileId.replace(/--/g, path.sep);
  const ext = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) return null;
  const resolved = path.resolve(/*turbopackIgnore: true*/ agentDir, fileName);
  if (!isInside(agentDir, resolved)) return null;
  return resolved;
}

function fileIdFromName(name: string): string {
  return name.replace(/[\\/]/g, "--");
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validateContent(ext: string, content: string): string | null {
  if (ext === ".json") {
    try { JSON.parse(content); } catch (e) {
      return `Invalid JSON: ${(e as Error).message}`;
    }
  }
  if (ext === ".yaml" || ext === ".yml") {
    const document = parseDocument(content);
    if (document.errors.length) return `Invalid YAML: ${document.errors[0].message}`;
  }
  return null;
}

// ─── Backup ───────────────────────────────────────────────────────────────────

async function createBackup(filePath: string): Promise<string | null> {
  try {
    const existing = await readFile(filePath, "utf-8").catch(() => null);
    if (existing === null) return null;
    const backupDir = path.join(path.dirname(filePath), ".backups");
    await mkdir(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${path.basename(filePath)}.${ts}.bak`;
    const backupPath = path.join(backupDir, backupName);
    await writeFile(backupPath, existing, "utf-8");
    return backupPath;
  } catch {
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function listConfigFiles(agentId: string): Promise<ConfigFile[]> {
  const agentDir = safeAgentDir(agentId);
  if (!agentDir) return [];

  try {
    const entries = await readdir(agentDir, { withFileTypes: true });
    const files: ConfigFile[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.startsWith(".")) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTENSIONS.has(ext)) continue;

      const fullPath = path.join(agentDir, entry.name);
      const info = await stat(fullPath).catch(() => null);
      if (!info) continue;

      files.push({
        id: fileIdFromName(entry.name),
        name: entry.name,
        ext,
        relativePath: entry.name,
        size: info.size,
        modifiedAt: info.mtime.toISOString(),
      });
    }

    return files.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export async function readConfigFile(agentId: string, fileId: string): Promise<ConfigFileContent> {
  const filePath = safeFilePath(agentId, fileId);
  const fileName = fileId.replace(/--/g, path.sep);
  const ext = path.extname(fileName).toLowerCase();

  if (!filePath) {
    return { id: fileId, name: fileName, ext, content: "", missing: true };
  }

  try {
    const content = await readFile(filePath, "utf-8");
    return { id: fileId, name: fileName, ext, content, missing: false };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { id: fileId, name: fileName, ext, content: "", missing: true };
    }
    throw err;
  }
}

export async function writeConfigFile(
  agentId: string,
  fileId: string,
  content: string
): Promise<{ ok: boolean; backupPath?: string | null; diff?: string[]; error?: string }> {
  const filePath = safeFilePath(agentId, fileId);
  if (!filePath) return { ok: false, error: "Invalid file path" };

  const ext = path.extname(filePath).toLowerCase();
  const validationError = validateContent(ext, content);
  if (validationError) return { ok: false, error: validationError };

  const agentDir = path.dirname(filePath);
  await mkdir(agentDir, { recursive: true });

  const previous = await readFile(filePath, "utf-8").catch(() => "");
  const before = previous.split("\n");
  const after = content.split("\n");
  const diff: string[] = [];
  for (let index = 0; index < Math.max(before.length, after.length) && diff.length < 200; index += 1) {
    if (before[index] === after[index]) continue;
    if (before[index] !== undefined) diff.push(`-${index + 1}: ${before[index]}`);
    if (after[index] !== undefined) diff.push(`+${index + 1}: ${after[index]}`);
  }
  const backupPath = await createBackup(filePath);
  await writeFile(filePath, content, "utf-8");

  return { ok: true, backupPath, diff };
}

export async function listBackups(agentId: string, fileId: string): Promise<string[]> {
  const filePath = safeFilePath(agentId, fileId);
  if (!filePath) return [];

  const backupDir = path.join(path.dirname(filePath), ".backups");
  const baseName = path.basename(filePath);

  try {
    const entries = await readdir(backupDir);
    return entries
      .filter((e) => e.startsWith(baseName) && e.endsWith(".bak"))
      .sort()
      .reverse()
      .slice(0, 10);
  } catch {
    return [];
  }
}

export async function rollbackConfigFile(
  agentId: string,
  fileId: string,
  backupName: string
): Promise<{ ok: boolean; error?: string }> {
  const filePath = safeFilePath(agentId, fileId);
  if (!filePath) return { ok: false, error: "Invalid file path" };

  // backupName must not traverse
  if (backupName.includes("/") || backupName.includes("\\") || backupName.includes("..")) {
    return { ok: false, error: "Invalid backup name" };
  }

  const backupDir = path.join(path.dirname(filePath), ".backups");
  const backupPath = path.resolve(backupDir, backupName);
  if (!isInside(path.resolve(backupDir), backupPath)) {
    return { ok: false, error: "Invalid backup path" };
  }

  try {
    const content = await readFile(backupPath, "utf-8");
    await createBackup(filePath);
    await writeFile(filePath, content, "utf-8");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
