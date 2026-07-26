import type { VoiceProvider } from "../types";
import { MockVoiceProvider } from "./mock";
import { BrowserSpeechProvider } from "./browserSpeech";
import { OpenAIRealtimeProvider } from "./openaiRealtime";

export type VoiceProviderName = "mock" | "browser_stt" | "openai_realtime";

export function createVoiceProvider(): VoiceProvider {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem("sentinel.voice.provider") : null;
  // Default to the real browser speech provider, not the mock — a missing
  // NEXT_PUBLIC_VOICE_PROVIDER env var in a production deploy must not
  // silently hand every user a fabricated transcript. "mock" is only ever
  // used when explicitly selected (dev/testing), never as the fallback.
  const provider = (stored ?? process.env.NEXT_PUBLIC_VOICE_PROVIDER ?? "browser_stt") as VoiceProviderName;

  if (provider === "mock") return new MockVoiceProvider();
  if (provider === "openai_realtime") return new OpenAIRealtimeProvider();

  return new BrowserSpeechProvider();
}
