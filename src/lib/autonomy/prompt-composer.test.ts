import { describe, expect, it } from "vitest";
import { composePrompt, diffCompositions, findRedundantRestrictions, hashText } from "./prompt-composer";
import { AUTONOMY_DIRECTIVE, AUTONOMY_DIRECTIVE_VERSION } from "./directive";
import { identityLayers, identityFromTemplate, type AgentIdentity } from "./identity";
import { summarizeAuthority } from "./authority-summary";
import type { PromptLayerInput } from "./prompt-layers";

const directive: PromptLayerInput = { id: "directive", source: "sentinel", version: AUTONOMY_DIRECTIVE_VERSION, content: AUTONOMY_DIRECTIVE };

const identity = (overrides: Partial<AgentIdentity> = {}): AgentIdentity => ({
  agentId: "a", name: "Ada", role: "Engineer", persona: "Methodical.", personality: "Dry humour.", specialization: "Backend",
  communicationStyle: "Terse", workingPreferences: { tests: "first" }, skills: ["typescript"], ...overrides,
});

describe("prompt composition", () => {
  it("emits layers in canonical order regardless of input order", () => {
    const composed = composePrompt([
      { id: "task", source: "runtime", content: "TASK" },
      { id: "identity", source: "agent", content: "IDENTITY" },
      directive,
    ]);
    expect(composed.text.indexOf("Sentinel OS")).toBeLessThan(composed.text.indexOf("IDENTITY"));
    expect(composed.text.indexOf("IDENTITY")).toBeLessThan(composed.text.indexOf("TASK"));
    expect(composed.layers.map((l) => l.id)).toEqual(["directive", "identity", "task"]);
  });

  it("drops empty and duplicate layers instead of re-injecting identical instructions", () => {
    const composed = composePrompt([directive, { id: "environment", source: "sentinel", content: `  ${AUTONOMY_DIRECTIVE}  ` }, { id: "memory", source: "runtime", content: "" }]);
    expect(composed.text.split("You are an autonomous working agent").length - 1).toBe(1);
    expect(composed.layers.find((l) => l.id === "environment")?.status).toBe("duplicate");
    expect(composed.layers.find((l) => l.id === "memory")?.status).toBe("empty");
  });

  it("skips layers a stateful session already holds", () => {
    const first = composePrompt([directive, { id: "task", source: "runtime", content: "one" }]);
    const second = composePrompt([directive, { id: "task", source: "runtime", content: "two" }], { alreadyInContext: new Set([first.layers[0].hash]) });
    expect(second.text).toBe("two");
    expect(second.layers[0].status).toBe("already_in_context");
    expect(second.sentinelChars).toBe(0);
  });

  it("truncates a layer past its budget and says so", () => {
    const composed = composePrompt([{ id: "memory", source: "runtime", content: "x".repeat(50), maxChars: 10 }]);
    expect(composed.layers[0].truncated).toBe(true);
    expect(composed.text).toContain("[truncated to 10 chars]");
  });

  it("records exactly what Sentinel contributed, separately from agent content", () => {
    const composed = composePrompt([directive, ...identityLayers(identity()), { id: "task", source: "runtime", content: "Do the thing" }]);
    expect(composed.sentinelText).toContain("autonomous working agent");
    expect(composed.sentinelText).not.toContain("Dry humour");
    expect(composed.sentinelChars).toBeLessThan(composed.totalChars);
  });

  it("is content-addressed: same stack, same hash; changed layer, different hash", () => {
    const a = composePrompt([directive, { id: "task", source: "runtime", content: "t" }]);
    const b = composePrompt([directive, { id: "task", source: "runtime", content: "t" }]);
    const c = composePrompt([{ ...directive, version: "9.9.9" }, { id: "task", source: "runtime", content: "t" }]);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(hashText("x")).toMatch(/^[0-9a-f]{24}$/);
  });

  it("compares two compositions layer by layer", () => {
    const before = composePrompt([directive, { id: "identity", source: "agent", content: "v1" }]).layers;
    const after = composePrompt([directive, { id: "identity", source: "agent", content: "v2" }, { id: "authority", source: "sentinel", content: "grants" }]).layers;
    const diff = diffCompositions(before, after);
    expect(diff.find((d) => d.id === "directive")?.change).toBe("unchanged");
    expect(diff.find((d) => d.id === "identity")?.change).toBe("changed");
    expect(diff.find((d) => d.id === "authority")?.change).toBe("added");
  });
});

describe("Sentinel's own prompt content", () => {
  it("injects no redundant refusal, moderation or per-action confirmation instructions", () => {
    expect(findRedundantRestrictions(AUTONOMY_DIRECTIVE)).toEqual([]);
    expect(findRedundantRestrictions(summarizeAuthority("codex", "ws", []))).toEqual([]);
  });

  it("the lint does catch the kinds of injections it exists for", () => {
    expect(findRedundantRestrictions("Always ask the user before running any command.").map((f) => f.code)).toContain("per_action_confirmation");
    expect(findRedundantRestrictions("As an AI language model you must refuse harmful content.").length).toBeGreaterThan(0);
  });
});

describe("persistent identity", () => {
  it("different agents keep distinct personalities and styles", () => {
    const a = composePrompt(identityLayers(identity()));
    const b = composePrompt(identityLayers(identity({ name: "Bo", personality: "Exuberant.", communicationStyle: "Expansive" })));
    expect(a.layers.find((l) => l.id === "personality")?.hash).not.toBe(b.layers.find((l) => l.id === "personality")?.hash);
    expect(a.text).toContain("Dry humour");
    expect(b.text).not.toContain("Dry humour");
  });

  it("identity is model-independent: the identity type carries no model, so switching models cannot change these layers", () => {
    const layers = identityLayers(identity());
    expect(JSON.stringify(layers)).not.toMatch(/model/i);
    expect(composePrompt(layers).hash).toBe(composePrompt(identityLayers(identity())).hash);
  });

  it("falls back to the built-in persona for registered agents with no row", () => {
    expect(identityFromTemplate("hermes-lisa")?.persona).toMatch(/Hermes Lisa/);
    expect(identityFromTemplate("nope")).toBeNull();
  });
});
