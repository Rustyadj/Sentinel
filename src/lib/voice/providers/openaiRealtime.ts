import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "../types";

// Transport seam for a future server-minted OpenAI Realtime ephemeral session.
// Long-lived provider secrets must never be accepted by this browser adapter.
export class OpenAIRealtimeProvider implements VoiceProvider {
  readonly name = "openai_realtime";
  private status: VoiceStatus = "idle";
  private config: VoiceProviderConfig | null = null;

  async startSession(config: VoiceProviderConfig) {
    this.config = config;
    this.setStatus("error");
    const error = new Error("OpenAI Realtime requires a server-side ephemeral session endpoint.");
    config.onError?.(error);
    throw error;
  }

  async stopSession() { this.config = null; this.status = "idle"; }
  async sendAudio(_audio: Blob) { throw new Error("OpenAI Realtime session is not active"); }
  async sendText(_text: string) { throw new Error("OpenAI Realtime session is not active"); }
  getStatus() { return this.status; }
  private setStatus(status: VoiceStatus) { this.status = status; this.config?.onStatusChange?.(status); }
}
