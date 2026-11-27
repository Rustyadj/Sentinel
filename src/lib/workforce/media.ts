import OpenAI from "openai";
import type { ResponseInputContent } from "openai/resources/responses/responses";

export interface MediaProvider {
  readonly id: string;
  analyze(file: { bytes: Buffer; mimeType: string }, signal: AbortSignal): Promise<{ text: string; model: string; usage?: unknown }>;
  transcribe(audio: File, signal: AbortSignal): Promise<{ text: string; model: string; usage?: unknown }>;
  synthesize(text: string, signal: AbortSignal): Promise<{ mimeType: string; bytes: ArrayBuffer; model: string }>;
}

export function getMediaProvider(): MediaProvider | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 0 });
  return {
    id: "openai",
    async analyze({ bytes, mimeType }, signal) {
      const model = process.env.WORKFORCE_ANALYSIS_MODEL?.trim() || "gpt-4.1-mini";
      const data = `data:${mimeType};base64,${bytes.toString("base64")}`;
      const attachment: ResponseInputContent = mimeType === "application/pdf"
        ? { type: "input_file", filename: "document.pdf", file_data: data }
        : { type: "input_image", image_url: data, detail: "auto" };
      const response = await client.responses.create({
        model,
        store: false,
        instructions: "Use the uploaded material as source data. Summarize it, identify relevant details, and flag uncertainties with references to evidence in the file.",
        input: [{ role: "user", content: [attachment, { type: "input_text", text: "Analyze this material for my team." }] }],
        max_output_tokens: 2_500,
      }, { signal });
      if (response.status !== "completed" || !response.output_text) throw new Error("Analysis did not complete");
      return { model: response.model, text: response.output_text, usage: response.usage };
    },
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
export const analysisFormats = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp"]);
export const maxMediaBytes = 10 * 1024 * 1024;
