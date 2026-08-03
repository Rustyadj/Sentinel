import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getEffectiveLearningSettings, upsertLearningSettings } from "@/lib/learning/settings";
import { makeAgent, makeUser, makeWorkspace } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("release audit — Learning Settings (real, persisted, layered)", () => {
  it("falls back to hardcoded system defaults when nothing is set", async () => {
    const agent = await makeAgent("Settings default agent");
    const settings = await getEffectiveLearningSettings(agent.id);
    expect(settings.curiosityThreshold).toBe(0.6);
    expect(settings.minShadowSampleSize).toBe(5);
    expect(settings.autoDeployEnabled).toBe(false);
  });

  it("a workspace-level override applies to its agents without discarding other default fields", async () => {
    const owner = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Settings override workspace");
    const agent = await makeAgent("Settings override agent");
    await db.agent.update({ where: { id: agent.id }, data: { workspaceId: workspace.id } });

    await upsertLearningSettings("workspace", workspace.id, {
      curiosityThreshold: 0.9,
      autoDeployEnabled: true,
    });

    const settings = await getEffectiveLearningSettings(agent.id);
    expect(settings.curiosityThreshold).toBe(0.9);
    expect(settings.autoDeployEnabled).toBe(true);
    expect(settings.minShadowSampleSize).toBe(5); // untouched field still falls through to system default
  });

  it("an agent-level override wins over its workspace's override", async () => {
    const owner = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Settings precedence workspace");
    const agent = await makeAgent("Settings precedence agent");
    await db.agent.update({ where: { id: agent.id }, data: { workspaceId: workspace.id } });

    await upsertLearningSettings("workspace", workspace.id, { curiosityThreshold: 0.9 });
    await upsertLearningSettings("agent", agent.id, { curiosityThreshold: 0.3 });

    const settings = await getEffectiveLearningSettings(agent.id);
    expect(settings.curiosityThreshold).toBe(0.3);
  });

  it("rejects out-of-range values instead of persisting nonsense", async () => {
    const owner = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Settings validation workspace");
    await expect(
      upsertLearningSettings("workspace", workspace.id, { curiosityThreshold: 1.5 }),
    ).rejects.toThrow(/curiosityThreshold/i);
    await expect(
      upsertLearningSettings("workspace", workspace.id, { minShadowSampleSize: 0 }),
    ).rejects.toThrow(/minShadowSampleSize/i);
  });
});
