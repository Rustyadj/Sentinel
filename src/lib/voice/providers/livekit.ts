import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "../types";

/**
 * Real WebRTC voice provider backed by LiveKit. The browser side only does
 * three things: mint a scoped token from /api/voice/token, join the room,
 * and publish the mic track. Everything else — VAD, turn detection,
 * Deepgram STT, routing the transcript through Sentinel's normal /api/chat
 * turn (so voice never bypasses tools/memory/skills), and Cartesia TTS
 * played back into the room — happens in the separate LiveKit Agents worker
 * (see docs/voice/LIVEKIT_ARCHITECTURE.md). This provider is honest about
 * that split: it never fabricates a transcript or a spoken response itself.
 */
export class LiveKitVoiceProvider implements VoiceProvider {
  readonly name = "livekit";
  private status: VoiceStatus = "idle";
  private config: VoiceProviderConfig | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- livekit-client is loaded dynamically to keep it out of the initial bundle
  private room: any = null;

  async startSession(config: VoiceProviderConfig): Promise<void> {
    this.config = config;
    if (!config.agentId || !config.roomId) {
      const error = new Error("LiveKit voice requires both agentId and roomId");
      config.onError?.(error);
      throw error;
    }

    let tokenResponse: Response;
    try {
      tokenResponse = await fetch("/api/voice/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: config.agentId, roomId: config.roomId }),
      });
    } catch {
      const error = new Error("Could not reach the voice token endpoint");
      config.onError?.(error);
      throw error;
    }

    if (!tokenResponse.ok) {
      const body = await tokenResponse.json().catch(() => null) as { error?: string } | null;
      const error = new Error(body?.error ?? "Voice is not available on this deployment");
      config.onError?.(error);
      throw error;
    }

    const { url, token } = await tokenResponse.json() as { url: string; token: string };

    const { Room, RoomEvent } = await import("livekit-client");
    const room = new Room();
    this.room = room;

    room.on(RoomEvent.TranscriptionReceived, (segments: Array<{ text: string; final: boolean }>) => {
      for (const segment of segments) {
        config.onTranscript?.({ text: segment.text, isFinal: segment.final });
      }
    });
    room.on(RoomEvent.Disconnected, () => this.setStatus("idle"));
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers: Array<{ isLocal: boolean }>) => {
      const agentSpeaking = speakers.some((speaker) => !speaker.isLocal);
      if (this.status !== "error") this.setStatus(agentSpeaking ? "speaking" : "listening");
    });

    try {
      await room.connect(url, token);
      await room.localParticipant.setMicrophoneEnabled(true);
      this.setStatus("listening");
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to join the voice session");
      config.onError?.(error);
      this.setStatus("error");
      throw error;
    }
  }

  async stopSession(): Promise<void> {
    await this.room?.disconnect();
    this.room = null;
    this.config = null;
    this.setStatus("idle");
  }

  async sendAudio(_audio: Blob): Promise<void> {
    // No-op by design: LiveKit streams the published mic track continuously
    // once the session starts — there's no discrete "send this clip" call.
  }

  async sendText(text: string): Promise<void> {
    if (!this.room) throw new Error("No active voice session");
    await this.room.localParticipant.sendText(text, { topic: "lk.chat" });
  }

  getStatus(): VoiceStatus {
    return this.status;
  }

  private setStatus(s: VoiceStatus) {
    this.status = s;
    this.config?.onStatusChange?.(s);
  }
}
