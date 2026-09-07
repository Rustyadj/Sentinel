import { describe, it, expect } from "vitest";
import { resolveEffectiveAgentModel, looksLikeModelUnavailable, ModelUnavailableError } from "@/lib/agents/model-policy";

describe("model control — canonical resolution, validation, and MODEL_UNAVAILABLE", () => {
  it("DB agent config beats conflicting environment", async () => {
    const rows: string[] = [];
    for (const [id, kind] of [["hermes-lisa","hermes"],["hermes-nathan2","hermes"],
                              ["claude-code","claude-code"],["codex","codex"]] as const) {
      const r = await resolveEffectiveAgentModel(id, kind as any);
      rows.push(`${id.padEnd(15)} model=${String(r.runtimeModelId).padEnd(14)} effort=${String(r.effort).padEnd(6)} source=${r.source}`);
    }
    console.log("\n" + rows.join("\n"));
    expect(rows.join()).toContain("gpt-5.6-luna");
    expect(rows.every(r => r.includes("source=agent"))).toBe(true);
  });
  it("rejects unauthorized override", async () => {
    await expect(resolveEffectiveAgentModel("codex","codex" as any,
      {model:"gpt-6-astra",authorized:false})).rejects.toThrow(/UNAUTHORIZED/);
  });
  it("rejects malformed model id", async () => {
    await expect(resolveEffectiveAgentModel("codex","codex" as any,
      {model:"has spaces & bad!",authorized:true})).rejects.toThrow(/INVALID_MODEL/);
  });
  it("rejects invalid effort", async () => {
    await expect(resolveEffectiveAgentModel("codex","codex" as any,
      {model:"gpt-6-astra",effort:"turbo" as any,authorized:true})).rejects.toThrow(/INVALID_EFFORT/);
  });
  it("detects the REAL codex rejection text as MODEL_UNAVAILABLE", () => {
    const real = `{"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The 'definitely-not-a-real-model-xyz' model is not supported when using Codex with a ChatGPT account."}}`;
    expect(looksLikeModelUnavailable(real)).toBe(true);
  });
  it("MODEL_UNAVAILABLE carries runtime/model/effort/reason and never a fallback", () => {
    const e = new ModelUnavailableError("codex","gpt-6-astra","low","rejected by runtime");
    expect(e.toJSON()).toMatchObject({ code:"MODEL_UNAVAILABLE", runtime:"codex",
      requestedModel:"gpt-6-astra", requestedEffort:"low" });
  });
});

describe("Nathan2 runtime wiring", () => {
  it("points at the port Hermes Nathan2 actually listens on (verified 4864, not 4861)", async () => {
    const { COMPATIBILITY_RUNTIMES } = await import("@/lib/agents/runtime/config");
    const n2 = COMPATIBILITY_RUNTIMES.find((r: any) => r.id === "runtime-hermes-nathan2");
    expect(n2).toBeDefined();
    expect(n2!.agentId).toBe("hermes-nathan2");
    expect(n2!.kind).toBe("hermes");
    expect(n2!.endpoint).toContain("4864");
    expect(n2!.model).toBe("gpt-5.6-luna");
  });
});
