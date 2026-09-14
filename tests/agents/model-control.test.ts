// @vitest-environment node
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { resolveEffectiveAgentModel, sessionModelConfiguration, modelProvenance, validateModelConfiguration, sentinelModelDefault } from "@/lib/agents/model-policy";
import { COMPATIBILITY_RUNTIMES } from "@/lib/agents/runtime/config";
import { RUNTIME_AGENT_MAP } from "@/lib/agents/runtime/chat-routing";
import { recordProductionFailure, PRODUCTION_FAILURE_SIGNALS } from "@/lib/learning/production-failures";
import { validateExperimentModels } from "@/lib/learning/experiment-models";
import { hasDatabase, makeAgent, makeUser, makeWorkspace } from "../neural-engine/db-setup";

const actor = vi.hoisted(() => ({ id: "" }));
vi.mock("@/lib/current-user", () => ({ requireUser: async () => ({ id: actor.id }) }));
vi.mock("@/lib/agents/permissions", async importOriginal => ({ ...await importOriginal<object>(), requireAgentRecordUser: async () => null }));
afterAll(async () => { await db.$disconnect(); });
afterEach(() => { delete process.env.SENTINEL_CODEX_DEFAULT_MODEL; });

describe("canonical model configuration", () => {
  it("has exactly one Nathan2 runtime and chat identity with verified Hermes capabilities", () => {
    expect(COMPATIBILITY_RUNTIMES.filter(r => r.agentId === "hermes-nathan2")).toHaveLength(1);
    expect(COMPATIBILITY_RUNTIMES.find(r => r.agentId === "hermes-nathan2")).toMatchObject({ id: "runtime-hermes-nathan2", model: "gpt-5.6-luna", capabilities: { streaming: true, resume: true, cancel: true } });
    expect(RUNTIME_AGENT_MAP["hermes-nathan2"].runtimeId).toBe("runtime-hermes-nathan2");
  });
  it("keeps the requested Sentinel defaults", () => {
    expect(sentinelModelDefault("hermes").runtimeModelId).toBe("gpt-5.6-luna");
    expect(sentinelModelDefault("claude-code")).toMatchObject({ runtimeModelId: "claude-opus-5", effort: "low" });
    expect(sentinelModelDefault("codex")).toMatchObject({ runtimeModelId: "gpt-6-astra", effort: "low" });
  });
  it("rejects invalid model IDs and efforts", () => {
    for (const model of ["", "--model", "x y", "x;touch /tmp/pwn", "x\n"]) expect(() => validateModelConfiguration("codex", model, "low")).toThrow();
    expect(() => validateModelConfiguration("codex", "gpt-6-astra", "extreme")).toThrow();
    expect(() => validateModelConfiguration("claude-code", "claude-opus-5", "none")).toThrow();
  });
  it("rejects unauthorized overrides and model saves", async () => {
    await expect(resolveEffectiveAgentModel("codex", "codex", { model: "gpt-6-astra", authorized: false })).rejects.toThrow("UNAUTHORIZED");
    const { PUT } = await import("@/app/api/agents/[id]/model/route");
    expect((await PUT(new Request("http://localhost/api/agents/codex/model", { method: "PUT", body: JSON.stringify({ model: "gpt-6-astra" }) }), { params: Promise.resolve({ id: "codex" }) })).status).toBe(403);
  });
  it("prevents generator from acting as sole final judge", () => {
    expect(() => validateExperimentModels({ generator: "lisa", evaluator: "lisa", adversary: "codex", guardian: "lisa" })).toThrow();
  });
});

describe.skipIf(!hasDatabase())("model and evolution persistence", () => {
  it("inserts the canonical Nathan2 Agent and runtime additively", async () => {
    expect(await db.agent.findUnique({ where: { id: "hermes-nathan2" } })).toMatchObject({ name: "Hermes Nathan2", memoryScope: "org" });
    expect(await db.agentRuntime.findUnique({ where: { id: "runtime-hermes-nathan2" } })).toMatchObject({ agentId: "hermes-nathan2", kind: "hermes" });
  });
  it("resolves session > persisted agent > environment > builtin and preserves historical snapshots", async () => {
    const agent = await makeAgent();
    try {
      await db.agent.update({ where: { id: agent.id }, data: { model: "gpt-6-astra", reasoningEffort: "low" } });
      process.env.SENTINEL_CODEX_DEFAULT_MODEL = "gpt-5.6-sol";
      const first = await resolveEffectiveAgentModel(agent.id, "codex");
      expect(first).toMatchObject({ runtimeModelId: "gpt-6-astra", effort: "low", source: "agent" });
      const snapshot = modelProvenance(agent.id, "codex", first);
      await db.agent.update({ where: { id: agent.id }, data: { model: "gpt-5.6-sol", reasoningEffort: "high" } });
      expect(await resolveEffectiveAgentModel(agent.id, "codex")).toMatchObject({ runtimeModelId: "gpt-5.6-sol", effort: "high" });
      expect(sessionModelConfiguration(snapshot)).toMatchObject({ runtimeModelId: "gpt-6-astra", effort: "low" });
      expect(await resolveEffectiveAgentModel(agent.id, "codex", { model: "gpt-6-astra", effort: "medium", authorized: true })).toMatchObject({ source: "session", effort: "medium" });
      expect(await resolveEffectiveAgentModel("missing-agent", "codex")).toMatchObject({ source: "environment" });
      delete process.env.SENTINEL_CODEX_DEFAULT_MODEL;
      expect(await resolveEffectiveAgentModel("missing-agent", "codex")).toMatchObject({ source: "builtin" });
    } finally { await db.agent.delete({ where: { id: agent.id } }); }
  });
  it.each(PRODUCTION_FAILURE_SIGNALS)("compiles %s, deduplicates it, and redacts credentials", async source => {
    const user = await makeUser();
    const workspace = await makeWorkspace(user.id);
    const input = { sourceId: `test-${source}`, workspaceId: workspace.id, userId: user.id, context: { error: "Bearer abcdefghijklmnopqrstuvwxyz123456", token: "secret-value", signal: source } };
    const a = await recordProductionFailure(source, input);
    const b = await recordProductionFailure(source, input);
    expect(a.created).toBe(true); expect(b.created).toBe(false); expect(a.evalCase.id).toBe(b.evalCase.id);
    expect(JSON.stringify(a.evalCase.sanitizedInput)).not.toContain("secret-value");
    expect(JSON.stringify(a.evalCase.sanitizedInput)).not.toContain("abcdefghijklmnopqrstuvwxyz123456");
  });
  it("tenant-scopes Guardian and adversarial GET routes including hostile filters", async () => {
    const user = await makeUser(); actor.id = user.id;
    const own = await makeWorkspace(user.id);
    const other = await makeWorkspace((await makeUser()).id);
    const ownRun = await db.adversarialRun.create({ data: { attackType: "prompt_injection", targetSurface: "tool", payload: {}, workspaceId: own.id } });
    const otherRun = await db.adversarialRun.create({ data: { attackType: "prompt_injection", targetSurface: "tool", payload: {}, workspaceId: other.id } });
    const ownDecision = await db.guardianDecision.create({ data: { action: "review", actor: "agent", tier: 1, mode: "observe", risk: "low", policyDecision: "allow", guardianDecision: "allow", workspaceId: own.id } });
    const { GET: guardian } = await import("@/app/api/learning/guardian/route");
    const { GET: adversarial } = await import("@/app/api/learning/adversarial/route");
    const runs = await (await adversarial(new Request("http://localhost/api/learning/adversarial"))).json();
    expect(runs.map((r: { id: string }) => r.id)).toContain(ownRun.id);
    expect(runs.map((r: { id: string }) => r.id)).not.toContain(otherRun.id);
    expect((await (await guardian(new Request("http://localhost/api/learning/guardian"))).json()).map((r: { id: string }) => r.id)).toContain(ownDecision.id);
    expect(await (await guardian(new Request(`http://localhost/api/learning/guardian?workspaceId=${other.id}`))).json()).toEqual([]);
  });
});
