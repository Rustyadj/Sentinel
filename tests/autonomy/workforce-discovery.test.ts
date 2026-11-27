import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { loadCapabilityRegistry } from "@/lib/autonomy/capability-registry";
import { db } from "@/lib/db";

const scope = randomUUID();
const ownWorkspaceId = scope + "-own";
const otherWorkspaceId = scope + "-other";

afterAll(async () => {
  await db.agentRuntime.deleteMany({ where: { workspaceId: { in: [ownWorkspaceId, otherWorkspaceId] } } });
  await db.$disconnect();
});

it("canonical workforce discovery includes runtime bindings only from the selected workspace", async () => {
  await db.agentRuntime.createMany({
    data: [
      { workspaceId: ownWorkspaceId, agentId: scope + "-research", kind: "codex", transport: "cli", executionVerified: true },
      { workspaceId: otherWorkspaceId, agentId: scope + "-reporting", kind: "codex", transport: "cli", executionVerified: true },
    ],
  });
  const capabilities = await loadCapabilityRegistry(ownWorkspaceId);
  expect(capabilities).toContainEqual(expect.objectContaining({ key: `agent:${scope}-research`, available: true }));
  expect(capabilities).not.toContainEqual(expect.objectContaining({ key: `agent:${scope}-reporting` }));
});
