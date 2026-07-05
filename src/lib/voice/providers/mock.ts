import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "../types";

export class MockVoiceProvider implements VoiceProvider {
  readonly name = "mock";
  private status: VoiceStatus = "idle";
  private config: VoiceProviderConfig | null = null;
  private sessionTimer: ReturnType<typeof setTimeout> | null = null;

  async startSession(config: VoiceProviderConfig): Promise<void> {
    this.config = config;
    this.setStatus("listening");
    // Simulate a transcript after 2 seconds
    this.sessionTimer = setTimeout(() => {
      this.config?.onTranscript?.({
        text: "Hello, this is a mock voice transcript",
        isFinal: true,
        confidence: 0.95,
      });
      this.setStatus("idle");
    }, 2000);
  }

  async stopSession(): Promise<void> {
    if (this.sessionTimer) clearTimeout(this.sessionTimer);
    this.config = null;
    this.setStatus("idle");
  }

  async sendAudio(_audio: Blob): Promise<void> {
    // Mock: do nothing
  }

  async sendText(text: string): Promise<void> {
    this.setStatus("thinking");
    this.config?.onTranscript?.({ text, isFinal: true });
    setTimeout(() => this.setStatus("idle"), 500);
  }

  getStatus(): VoiceStatus {
    return this.status;
  }

  private setStatus(s: VoiceStatus) {
    this.status = s;
    this.config?.onStatusChange?.(s);
  }
}
