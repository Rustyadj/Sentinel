import type { VoiceProvider } from "../types";
import { MockVoiceProvider } from "./mock";
import { BrowserSpeechProvider } from "./browserSpeech";
import { OpenAIRealtimeProvider } from "./openaiRealtime";
import { LiveKitVoiceProvider } from "./livekit";

export type VoiceProviderName = "mock" | "browser_stt" | "openai_realtime" | "livekit";

export const VOICE_PROVIDER_STORAGE_KEY = "sentinel.voice.provider";

// Default to the authenticated OpenAI Realtime provider. It fails closed when
// the server credential is unavailable and never exposes the long-lived key.
// "mock" is only ever
// used when explicitly selected (dev/testing), never as the fallback.
// "livekit" (the full WebRTC + Deepgram + Cartesia stack) is opt-in only —
// it requires a separately deployed Agents worker, so it's never the
// silent default either. See docs/voice/LIVEKIT_ARCHITECTURE.md. User
// preference (set in Settings) takes priority over the build-time env var.
export function createVoiceProvider(): VoiceProvider {
  const stored =
    typeof window !== "undefined" ? window.localStorage.getItem(VOICE_PROVIDER_STORAGE_KEY) : null;
  const provider = (stored ?? process.env.NEXT_PUBLIC_VOICE_PROVIDER ?? "browser_stt") as VoiceProviderName;

  if (provider === "mock") return new MockVoiceProvider();
  if (provider === "openai_realtime") return new OpenAIRealtimeProvider();
  if (provider === "livekit") return new LiveKitVoiceProvider();

  return new BrowserSpeechProvider();
}
