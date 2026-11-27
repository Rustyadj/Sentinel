import { afterEach, expect, it, vi } from "vitest";
import { getMediaProvider } from "@/lib/workforce/media";

const adapter = vi.hoisted(() => ({
  transcribe: vi.fn(),
  speech: vi.fn(),
  analyze: vi.fn(),
}));
vi.mock("openai", () => ({
  default: class {
    audio = { transcriptions: { create: adapter.transcribe }, speech: { create: adapter.speech } };
    responses = { create: adapter.analyze };
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("reports an unavailable provider when the deployment has no OpenAI key", () => {
  vi.stubEnv("OPENAI_API_KEY", "");
  expect(getMediaProvider()).toBeNull();
});

it("preserves the SDK result shape for transcription, synthetic speech, and analysis", async () => {
  vi.stubEnv("OPENAI_API_KEY", "test-provider-key");
  vi.stubEnv("WORKFORCE_ANALYSIS_MODEL", "test-vision-model");
  const provider = getMediaProvider()!;
  const signal = new AbortController().signal;
  const audio = new File(["sound"], "test.wav", { type: "audio/wav" });
  adapter.transcribe.mockResolvedValue({ text: "Weekly report", usage: { type: "duration", seconds: 1 } });
  adapter.speech.mockResolvedValue({ arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
  adapter.analyze.mockResolvedValue({ status: "completed", model: "test-vision-model", output_text: "A weekly report." });

  expect(await provider.transcribe(audio, signal)).toMatchObject({ text: "Weekly report", usage: { seconds: 1 } });
  expect(await provider.synthesize("Weekly report", signal)).toMatchObject({ mimeType: "audio/mpeg" });
  expect(await provider.analyze({ bytes: Buffer.from("PDF"), mimeType: "application/pdf" }, signal))
    .toMatchObject({ model: "test-vision-model", text: "A weekly report." });
  expect(adapter.analyze).toHaveBeenCalledWith(expect.objectContaining({
    model: "test-vision-model",
    store: false,
    input: [expect.objectContaining({
      content: expect.arrayContaining([expect.objectContaining({ type: "input_file", file_data: "data:application/pdf;base64,UERG" })]),
    })],
  }), { signal });
});
