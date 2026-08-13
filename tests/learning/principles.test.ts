import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { distillPrinciple, evolvePrinciple, getPrincipleHistory } from "@/lib/learning/principles";
import { makeUser, uid } from "../neural-engine/db-setup";

afterAll(async () => {
  await db.$disconnect();
});

describe("Principle distillation", () => {
  it("repeated, corroborating evidence distills a reusable principle", async () => {
    const statement = `Verify deployment target before destructive operations ${uid("nonce")}`;
    const result = await distillPrinciple({
      statement,
      scope: "workspace",
      domain: "deployment",
      evidenceConfidence: 0.75,
      supportingExperienceIds: [uid("exp"), uid("exp"), uid("exp"), uid("exp")],
      changeReason: "four corroborating corrections",
    });
    expect(result.distilled).toBe(true);
    expect(result.principle).not.toBeNull();
    expect(result.principle?.evidenceCount).toBeGreaterThanOrEqual(3);
    expect(result.principle?.currentVersion).toBe(1);
  });

  it("a single anecdote does not become a global principle", async () => {
    const result = await distillPrinciple({
      statement: `Single anecdote rule ${uid("nonce")}`,
      scope: "workspace",
      evidenceConfidence: 0.9,
      supportingExperienceIds: [uid("exp")],
      changeReason: "one correction",
    });
    expect(result.distilled).toBe(false);
    expect(result.principle).toBeNull();
    expect(result.reasons.join(" ")).toMatch(/distinct supporting experience/);
  });

  it("an unresolved high-confidence contradiction blocks distillation", async () => {
    const experienceIds = [uid("exp"), uid("exp"), uid("exp")];
    const result = await distillPrinciple({
      statement: `Contradicted rule ${uid("nonce")}`,
      scope: "workspace",
      evidenceConfidence: 0.8,
      supportingExperienceIds: experienceIds,
      contradictingExperienceIds: [uid("exp"), uid("exp"), uid("exp")],
      changeReason: "mixed evidence",
    });
    expect(result.distilled).toBe(false);
    expect(result.reasons.join(" ")).toMatch(/contradicting/);
  });

  it("principle versions preserve history — evolving a principle never silently overwrites it", async () => {
    const initial = await distillPrinciple({
      statement: "Always ask before deployment",
      scope: "workspace",
      domain: `deployment_${uid("nonce")}`,
      evidenceConfidence: 0.7,
      supportingExperienceIds: [uid("exp"), uid("exp"), uid("exp")],
      changeReason: "initial rule",
    });
    const principleId = initial.principle!.id;

    const actor = await makeUser();
    await evolvePrinciple({
      principleId,
      statement: "Ask before deployment only when the target environment cannot be resolved deterministically",
      changeReason: "refined after further evidence",
      actorId: actor.id,
    });

    const history = await getPrincipleHistory(principleId);
    expect(history.length).toBe(2);
    expect(history[0].version).toBe(1);
    expect(history[1].version).toBe(2);
    expect(history[0].statement).not.toBe(history[1].statement);

    const current = await db.principle.findUniqueOrThrow({ where: { id: principleId } });
    expect(current.currentVersion).toBe(2);
    expect(current.statement).toBe(history[1].statement);
  });
});
