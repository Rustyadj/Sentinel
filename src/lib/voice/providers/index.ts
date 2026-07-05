import type { VoiceProvider } from "../types";
import { MockVoiceProvider } from "./mock";
import { BrowserSpeechProvider } from "./browserSpeech";

export const VOICE_PROVIDER_STORAGE_KEY = "sentinel:voice-provider";

// Real browser speech recognition is the default — mock is an explicit
// opt-in for environments without mic access (headless testing, no Web Speech
// API support). User preference (set in Settings) takes priority over the
// build-time env var.
export function createVoiceProvider(): VoiceProvider {
  const stored =
    typeof window !== "undefined" ? window.localStorage.getItem(VOICE_PROVIDER_STORAGE_KEY) : null;
  const provider =
    stored ??
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_VOICE_PROVIDER) ??
    "browser_stt";

  if (provider === "mock") {
    return new MockVoiceProvider();
  }

  return new BrowserSpeechProvider();
}
