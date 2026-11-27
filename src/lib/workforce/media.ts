import OpenAI from "openai";

export interface SpeechProvider {
  readonly id: string;
  transcribe(audio: File, signal: AbortSignal): Promise<{ text: string; model: string; usage?: unknown }>;
  synthesize(text: string, signal: AbortSignal): Promise<{ mimeType: string; bytes: ArrayBuffer; model: string }>;
}

export function getSpeechProvider(): SpeechProvider | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0 });
  return {
    id: "openai",
    async transcribe(file, signal) {
      const model = "gpt-4o-mini-transcribe";
      const result = await client.audio.transcriptions.create({ file, model, response_format: "json" }, { signal });
      return { model, text: result.text, usage: result.usage };
    },
    async synthesize(input, signal) {
      const model = "gpt-4o-mini-tts";
      const audio = await client.audio.speech.create({ model, voice: "coral", input, response_format: "mp3" }, { signal });
      return { mimeType: "audio/mpeg", bytes: await audio.arrayBuffer(), model };
    },
  };
}

export const audioFormats: Readonly<Record<string, string>> = {
  "audio/mpeg": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/wav": "wav",
  "audio/x-wav": "wav", "audio/webm": "webm", "audio/flac": "flac", "audio/ogg": "ogg",
};
export const maxAudioBytes = 10 * 1024 * 1024;
