import type { VoiceProvider } from "../types";
import { MockVoiceProvider } from "./mock";
import { BrowserSpeechProvider } from "./browserSpeech";

export function createVoiceProvider(): VoiceProvider {
  const provider =
    (typeof process !== "undefined" && process.env.NEXT_PUBLIC_VOICE_PROVIDER) ?? "mock";

  if (provider === "browser_stt") {
    return new BrowserSpeechProvider();
  }

  return new MockVoiceProvider();
}
