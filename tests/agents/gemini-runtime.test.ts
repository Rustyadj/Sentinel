import { describe, it, expect } from "vitest";
import { resolveEffectiveAgentModel, MODEL_CHOICES } from "@/lib/agents/model-policy";
import { GeminiRuntimeAdapter } from "@/lib/agents/runtime/gemini";
import { COMPATIBILITY_RUNTIMES } from "@/lib/agents/runtime/config";

describe("Gemini runtime", () => {
  it("is registered as a runtime pointing at the gemini agent", () => {
    const r = COMPATIBILITY_RUNTIMES.find((x) => x.id === "runtime-gemini");
    expect(r).toBeDefined();
    expect(r!.agentId).toBe("gemini");
    expect(r!.kind).toBe("gemini");
  });

  it("resolves the operator default from the database", async () => {
    const c = await resolveEffectiveAgentModel("gemini", "gemini");
    expect(c.runtimeModelId).toBe("gemini-3.8-flash");
    expect(c.source).toBe("agent");
    expect(c.effort).toBeNull();
  });

  it("rejects a reasoning effort the CLI cannot honor", async () => {
    await expect(resolveEffectiveAgentModel("gemini", "gemini",
      { model: "gemini-3.8-flash", effort: "high", authorized: true }))
      .rejects.toThrow(/INVALID_EFFORT/);
  });

  it("only offers models proven available on this key", () => {
    expect(MODEL_CHOICES.gemini).toContain("gemini-3.8-flash");
    expect(MODEL_CHOICES.gemini).not.toContain("gemini-3.8-pro");
    expect(MODEL_CHOICES.gemini).not.toContain("gemini-3.8-flash-lite");
  });
});

describe("Gemini stream-json parsing (real observed frames)", () => {
  const adapter = new GeminiRuntimeAdapter(async () => { throw new Error("unused"); });
  const parse = (line: string) =>
    (adapter as unknown as { parseStructuredLine(l: string, s: string): { type: string; data: Record<string, unknown>; externalSessionId?: string } })
      .parseStructuredLine(line, "s1");

  it("takes the session id from the init frame", () => {
    const r = parse('{"type":"init","session_id":"594e55be-51ff-46ad-9533-52994cb43898","model":"auto"}');
    expect(r.externalSessionId).toBe("594e55be-51ff-46ad-9533-52994cb43898");
  });

  it("surfaces assistant content and ignores the echoed user turn", () => {
    expect(parse('{"type":"message","role":"assistant","content":"GEMINI_OK","delta":true}').type).toBe("assistant_delta");
    expect(parse('{"type":"message","role":"user","content":"hi"}').type).toBe("stdout");
  });

  it("reports the models the runtime actually used, not the one requested", () => {
    const r = parse('{"type":"result","status":"success","stats":{"models":{"gemini-3.1-flash-lite":{},"gemini-3.5-flash":{}}}}');
    expect(r.data.actualModel).toBe("gemini-3.1-flash-lite,gemini-3.5-flash");
  });

  it("treats a failed result as stderr so MODEL_UNAVAILABLE detection sees it", () => {
    const real = '{"type":"result","status":"error","error":{"message":"[API Error: models/gemini-3-pro is not found for API version v1beta]"}}';
    expect(parse(real).type).toBe("stderr");
  });

  it("does not crash on the CLI's non-JSON warning lines", () => {
    expect(parse("Ripgrep is not available. Falling back to GrepTool.").type).toBe("stdout");
  });
});
