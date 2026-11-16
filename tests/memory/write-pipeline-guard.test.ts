// Every durable memory write goes through src/lib/neural-engine/memory-write.ts.
//
// This is the test that keeps that true. A new `db.memory.create(...)` (or
// `tx.memory.update`, `client.memory.upsert`, ...) anywhere else in the
// application fails the suite, naming the file and line, instead of silently
// becoming a twelfth unauthorised write path.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { SERVICE_POLICIES, USER_EDITABLE_FIELDS } from "@/lib/neural-engine/memory-write";

const ROOT = join(__dirname, "..", "..");
// bench/ is excluded with tests/: its harness seeds fixture rows with fixed ids
// into a throwaway database, which is test tooling, not an application path.
const SCANNED = ["src", "worker", "scripts"];
const PIPELINE = "src/lib/neural-engine/memory-write.ts";
const WRITE = /\.memory\s*\.\s*(create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany)\s*[(<]/;

function* sourceFiles(dir: string): Generator<string> {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) yield* sourceFiles(path);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) yield path;
  }
}

describe("durable memory write pipeline", () => {
  it("has no memory write outside memory-write.ts", () => {
    const offenders: string[] = [];
    for (const top of SCANNED) {
      for (const file of sourceFiles(join(ROOT, top))) {
        const rel = relative(ROOT, file);
        if (rel === PIPELINE) continue;
        readFileSync(file, "utf8").split("\n").forEach((line, index) => {
          const code = line.replace(/\/\/.*$/, "");
          if (WRITE.test(code)) offenders.push(`${rel}:${index + 1}: ${line.trim()}`);
        });
      }
    }
    expect(offenders, "route these through memoryWriter()/userMemory functions").toEqual([]);
  });

  it("never lets an update move memory between tenants", () => {
    for (const field of ["owner", "scope", "projectId", "workspaceId", "botId"]) {
      expect(USER_EDITABLE_FIELDS.has(field)).toBe(false);
      for (const [service, rules] of Object.entries(SERVICE_POLICIES)) {
        expect(rules.update.has(field), `${service} may update ${field}`).toBe(false);
      }
    }
  });

  it("keeps content rewrites to the services that author content", () => {
    const rewriters = Object.entries(SERVICE_POLICIES).filter(([, rules]) => rules.update.has("content")).map(([s]) => s);
    expect(rewriters).toEqual(["consolidation"]);
  });
});
