import type { VoiceProvider } from "../types";
import { MockVoiceProvider } from "./mock";
import { BrowserSpeechProvider } from "./browserSpeech";
import { OpenAIRealtimeProvider } from "./openaiRealtime";

export type VoiceProviderName = "mock" | "browser_stt" | "openai_realtime";

export function createVoiceProvider(): VoiceProvider {
  const stored = typeof window !== "undefined" ? window.localStorage.getItem("sentinel.voice.provider") : null;
  const provider = (stored ?? process.env.NEXT_PUBLIC_VOICE_PROVIDER ?? "mock") as VoiceProviderName;

  if (provider === "browser_stt") {
    return new BrowserSpeechProvider();
  }
  if (provider === "openai_realtime") return new OpenAIRealtimeProvider();

  return new MockVoiceProvider();
}
