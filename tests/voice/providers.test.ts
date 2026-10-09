// Production-honesty regression: createVoiceProvider() must never silently
// hand a real user a fabricated transcript because an env var was left
// unset. "mock" is only ever used when explicitly selected.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createVoiceProvider } from "@/lib/voice/providers/index";
import { BrowserSpeechProvider } from "@/lib/voice/providers/browserSpeech";
import { MockVoiceProvider } from "@/lib/voice/providers/mock";
import { OpenAIRealtimeProvider } from "@/lib/voice/providers/openaiRealtime";

const STORAGE_KEY = "sentinel.voice.provider";

describe("createVoiceProvider — production default", () => {
  beforeEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
  });
  afterEach(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    delete process.env.NEXT_PUBLIC_VOICE_PROVIDER;
  });

  it("defaults to the OpenAI Realtime (GPT-Live) provider when nothing is configured", () => {
    delete process.env.NEXT_PUBLIC_VOICE_PROVIDER;
    const provider = createVoiceProvider();
    expect(provider).toBeInstanceOf(OpenAIRealtimeProvider);
    expect(provider).not.toBeInstanceOf(MockVoiceProvider);
  });

  it("falls back to the realtime provider for an unrecognised selection, never mock", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-a-provider");
    const provider = createVoiceProvider();
    expect(provider).toBeInstanceOf(OpenAIRealtimeProvider);
    expect(provider).not.toBeInstanceOf(MockVoiceProvider);
  });

  it("still offers browser speech as an explicit opt-in", () => {
    window.localStorage.setItem(STORAGE_KEY, "browser_stt");
    expect(createVoiceProvider()).toBeInstanceOf(BrowserSpeechProvider);
  });

  it("still honors an explicit mock selection (dev/testing only)", () => {
    window.localStorage.setItem(STORAGE_KEY, "mock");
    expect(createVoiceProvider()).toBeInstanceOf(MockVoiceProvider);
  });

  it("honors an explicit env override", () => {
    window.localStorage.removeItem(STORAGE_KEY);
    process.env.NEXT_PUBLIC_VOICE_PROVIDER = "mock";
    expect(createVoiceProvider()).toBeInstanceOf(MockVoiceProvider);
  });
});
