import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  LearningAccessError,
  requireSkillVersionAccess,
  requireLearningCandidateAccess,
  requireExperienceAccess,
} from "@/lib/learning/authorization";
import { makeAgent, makeUser, makeWorkspace, uid } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

// Every Learning Core require*Access guard throws the same LearningAccessError
// (404, "Learning resource not found") whether the id is genuinely nonexistent
// or belongs to another tenant — this is what makes existence non-inferable
// from the response. These tests prove that invariant holds for real resource
// types, not just document it.
describe("release audit — cross-tenant enumeration resistance", () => {
  it("a nonexistent skill version and a real foreign-tenant skill version produce identical errors", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Enumeration resistance workspace");
    const skill = await db.skill.create({
      data: {
        name: uid("enumeration-skill"),
        description: "test skill",
        domain: "test",
        owner: owner.id,
        workspaceId: workspace.id,
      },
    });
    const version = await db.skillVersion.create({
      data: { skillId: skill.id, version: 1, status: "draft", implementationType: "command" },
    });

    const nonexistentError = await requireSkillVersionAccess(outsider.id, uid("nonexistent"), "workspace.update")
      .catch((err) => err);
    const foreignTenantError = await requireSkillVersionAccess(outsider.id, version.id, "workspace.update")
      .catch((err) => err);

    expect(nonexistentError).toBeInstanceOf(LearningAccessError);
    expect(foreignTenantError).toBeInstanceOf(LearningAccessError);
    expect(foreignTenantError.status).toBe(nonexistentError.status);
    expect(foreignTenantError.message).toBe(nonexistentError.message);
  });

  it("does not let an outsider activate another workspace's skill version", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Skill activation workspace");
    const skill = await db.skill.create({
      data: {
        name: uid("activation-skill"),
        description: "test skill",
        domain: "test",
        owner: owner.id,
        workspaceId: workspace.id,
      },
    });
    const version = await db.skillVersion.create({
      data: { skillId: skill.id, version: 1, status: "candidate", implementationType: "command" },
    });

    // The route (src/app/api/learning/skill-versions/[id]/activate/route.ts) calls
    // requireSkillVersionAccess before ever calling activateSkillVersion — that
    // guard is the real boundary being tested here, matching this codebase's
    // route-authorizes / service-trusts-caller separation of concerns.
    await expect(requireSkillVersionAccess(outsider.id, version.id, "workspace.update"))
      .rejects.toBeInstanceOf(LearningAccessError);

    const unchanged = await db.skillVersion.findUniqueOrThrow({ where: { id: version.id } });
    expect(unchanged.status).not.toBe("active");
  });

  it("a nonexistent learning candidate and a real foreign-tenant candidate produce identical errors", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Candidate enumeration workspace");
    const agent = await makeAgent("Candidate enumeration agent");
    await db.agent.update({ where: { id: agent.id }, data: { workspaceId: workspace.id } });
    const experience = await db.experience.create({
      data: { agentId: agent.id, workspaceId: workspace.id, objective: "enumeration test" },
    });
    const candidate = await db.learningCandidate.create({
      data: { experienceId: experience.id, type: "memory", proposedPayload: { content: "x" }, status: "proposed" },
    });

    const nonexistentError = await requireLearningCandidateAccess(outsider.id, uid("nonexistent"), "workspace.update")
      .catch((err) => err);
    const foreignTenantError = await requireLearningCandidateAccess(outsider.id, candidate.id, "workspace.update")
      .catch((err) => err);

    expect(nonexistentError).toBeInstanceOf(LearningAccessError);
    expect(foreignTenantError).toBeInstanceOf(LearningAccessError);
    expect(foreignTenantError.status).toBe(nonexistentError.status);
    expect(foreignTenantError.message).toBe(nonexistentError.message);
  });

  it("a nonexistent experience and a real foreign-tenant experience produce identical errors", async () => {
    const owner = await makeUser();
    const outsider = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Experience enumeration workspace");
    const agent = await makeAgent("Experience enumeration agent");
    await db.agent.update({ where: { id: agent.id }, data: { workspaceId: workspace.id } });
    const experience = await db.experience.create({
      data: { agentId: agent.id, workspaceId: workspace.id, objective: "enumeration test" },
    });

    const nonexistentError = await requireExperienceAccess(outsider.id, uid("nonexistent"), "workspace.read")
      .catch((err) => err);
    const foreignTenantError = await requireExperienceAccess(outsider.id, experience.id, "workspace.read")
      .catch((err) => err);

    expect(nonexistentError).toBeInstanceOf(LearningAccessError);
    expect(foreignTenantError).toBeInstanceOf(LearningAccessError);
    expect(foreignTenantError.status).toBe(nonexistentError.status);
    expect(foreignTenantError.message).toBe(nonexistentError.message);
  });
});
