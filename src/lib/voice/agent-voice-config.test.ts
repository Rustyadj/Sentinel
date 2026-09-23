import { describe, expect, it } from "vitest";
import {
  GPT_LIVE_VOICE_MODEL,
  SENTINEL_REASONING_TOOL,
  liveSessionInstructions,
  resolveAgentVoiceConfig,
} from "./agent-voice-config";

describe("per-agent voice configuration", () => {
  it("gives Lisa the Sol voice and DeepSeek V4.1 Flash as her brain", () => {
    const lisa = resolveAgentVoiceConfig("hermes-lisa")!;
    expect(lisa.voice).toBe("sol");
    expect(lisa.voiceModel).toBe(GPT_LIVE_VOICE_MODEL);
    expect(lisa.reasoningModel).toBe("deepseek/deepseek-v4.1-flash");
    expect(lisa.reasoningProvider).toBe("openrouter");
  });

  it("gives Nathan2 the Spruce voice and GPT-5.6 Luna as his brain", () => {
    const nathan = resolveAgentVoiceConfig("hermes-nathan2")!;
    expect(nathan.voice).toBe("spruce");
    expect(nathan.voiceModel).toBe(GPT_LIVE_VOICE_MODEL);
    expect(nathan.reasoningModel).toBe("gpt-5.6-luna");
    expect(nathan.reasoningProvider).toBe("openai");
  });

  it("keeps the two agents' voices and brains disjoint", () => {
    const lisa = resolveAgentVoiceConfig("lisa")!;
    const nathan = resolveAgentVoiceConfig("nathan2")!;
    expect(lisa.voice).not.toBe(nathan.voice);
    expect(lisa.reasoningModel).not.toBe(nathan.reasoningModel);
    // The live layer is shared; the identity behind it is not.
    expect(lisa.voiceModel).toBe(nathan.voiceModel);
  });

  it("resolves every alias to exactly one canonical agent", () => {
    for (const alias of ["hermes-lisa", "lisa", "LISA", " Lisa "]) {
      expect(resolveAgentVoiceConfig(alias)?.agentId).toBe("hermes-lisa");
    }
    for (const alias of ["hermes-nathan2", "nathan2", "nathan", "NATHAN2"]) {
      expect(resolveAgentVoiceConfig(alias)?.agentId).toBe("hermes-nathan2");
    }
  });

  it("refuses an absent or unknown agent instead of defaulting to one", () => {
    // The previous resolver answered `undefined` with Lisa, so a request that
    // merely omitted agentId got Lisa's voice, instructions and identity.
    // Silently picking an agent is the identity swap this must never do.
    for (const value of [undefined, null, "", "   ", "hermes-clint", "unknown", "hermes"]) {
      expect(resolveAgentVoiceConfig(value)).toBeNull();
    }
  });

  it("scopes env overrides per agent so one cannot retune the other", () => {
    const env = { SENTINEL_VOICE_HERMES_LISA_VOICE: "cedar" };
    expect(resolveAgentVoiceConfig("hermes-lisa", env)?.voice).toBe("cedar");
    // Nathan2 is untouched by an override aimed at Lisa.
    expect(resolveAgentVoiceConfig("hermes-nathan2", env)?.voice).toBe("spruce");
  });

  it("tells the live layer it is the voice, not the mind", () => {
    const lisa = liveSessionInstructions(resolveAgentVoiceConfig("hermes-lisa")!);
    expect(lisa).toContain("Hermes Lisa");
    expect(lisa).toContain(SENTINEL_REASONING_TOOL);
    expect(lisa).toMatch(/not its mind/i);

    const nathan = liveSessionInstructions(resolveAgentVoiceConfig("hermes-nathan2")!);
    expect(nathan).toContain("Hermes Nathan2");
    // Neither agent's instructions mention the other.
    expect(lisa).not.toMatch(/nathan/i);
    expect(nathan).not.toMatch(/lisa/i);
  });
});
