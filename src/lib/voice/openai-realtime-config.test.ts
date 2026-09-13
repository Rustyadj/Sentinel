import { describe, expect, it } from "vitest";
import {
  getOpenAIRealtimeModelConfig,
  OPENAI_LIVE_TRANSCRIPTION_MODEL,
  OPENAI_REALTIME_FULL_MODEL,
  OPENAI_REALTIME_MINI_MODEL,
  resolveOpenAIRealtimeAgentId,
} from "./openai-realtime-config";

describe("OpenAI Realtime model configuration", () => {
  it("uses Realtime 2.1 Mini, full 2.1, and GPT Live by default", () => {
    expect(getOpenAIRealtimeModelConfig({})).toEqual({
      miniModel: OPENAI_REALTIME_MINI_MODEL,
      fullModel: OPENAI_REALTIME_FULL_MODEL,
      transcriptionModel: OPENAI_LIVE_TRANSCRIPTION_MODEL,
      voice: "marin",
    });
  });

  it("accepts only the two requested Hermes identities and their aliases", () => {
    expect(resolveOpenAIRealtimeAgentId()).toBe("hermes-lisa");
    expect(resolveOpenAIRealtimeAgentId("Lisa")).toBe("hermes-lisa");
    expect(resolveOpenAIRealtimeAgentId("hermes-nathan2")).toBe("nathan2");
    expect(resolveOpenAIRealtimeAgentId("Nathan")).toBe("nathan2");
    expect(resolveOpenAIRealtimeAgentId("openclaw")).toBeNull();
  });
});
