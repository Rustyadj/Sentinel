import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "../types";
import { SENTINEL_REASONING_TOOL } from "../agent-voice-config";

interface RealtimeSessionResponse {
  clientSecret: string;
  sessionId: string | null;
  agentId: string;
  voice: string;
  voiceModel: string;
  reasoningModel: string;
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  name?: string;
  call_id?: string;
  arguments?: string;
  item?: {
    type?: string;
    name?: string;
    call_id?: string;
    arguments?: string;
  };
}

export class OpenAIRealtimeProvider implements VoiceProvider {
  readonly name = "openai_realtime";
  private status: VoiceStatus = "idle";
  private config: VoiceProviderConfig | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private voiceModel = "";
  private agentId = "";
  private telemetrySessionId: string | null = null;
  /** Tool call ids already dispatched, so a repeated event cannot run a turn twice. */
  private dispatchedCalls = new Set<string>();
  private inputTranscript = "";

  async startSession(config: VoiceProviderConfig): Promise<void> {
    this.config = config;
    try {
      const tokenResponse = await fetch("/api/voice/openai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // No default: the caller must say which agent is speaking.
          // Falling back to Lisa here meant an unconfigured surface opened a
          // session in her voice and her conversation.
          agentId: config.agentId,
          roomId: config.roomId,
          language: config.language,
        }),
      });
      const token = await tokenResponse.json().catch(() => null) as (RealtimeSessionResponse & { error?: string }) | null;
      if (!tokenResponse.ok || !token?.clientSecret) {
        throw new Error(token?.error || "OpenAI Realtime is unavailable");
      }

      this.voiceModel = token.voiceModel;
      this.agentId = token.agentId;
      this.telemetrySessionId = token.sessionId;
      this.microphone = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });

      const peer = new RTCPeerConnection();
      this.peer = peer;
      for (const track of this.microphone.getTracks()) peer.addTrack(track, this.microphone);

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audio.setAttribute("playsinline", "true");
      this.audio = audio;
      peer.ontrack = (event) => {
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => undefined);
      };

      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.addEventListener("open", () => this.setStatus("listening"));
      channel.addEventListener("message", (event) => this.handleEvent(event.data));
      channel.addEventListener("close", () => {
        if (this.status !== "error") this.setStatus("idle");
      });

      peer.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected"].includes(peer.connectionState)) {
          this.fail(new Error("OpenAI Realtime connection was lost"));
        }
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!sdpResponse.ok) {
        throw new Error((await sdpResponse.text()).slice(0, 240) || "OpenAI rejected the voice connection");
      }
      await peer.setRemoteDescription({ type: "answer", sdp: await sdpResponse.text() });
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error("OpenAI Realtime failed to start");
      await this.cleanup();
      this.fail(error);
      throw error;
    }
  }

  async stopSession(): Promise<void> {
    await this.cleanup();
    this.setStatus("idle");
    this.config = null;
  }

  async sendAudio(audio: Blob): Promise<void> {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    this.send({ type: "input_audio_buffer.append", audio: btoa(binary) });
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
  }

  async sendText(text: string): Promise<void> {
    if (!text.trim()) return;
    this.send({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    this.send({ type: "response.create" });
  }

  getStatus(): VoiceStatus {
    return this.status;
  }

  private handleEvent(raw: unknown): void {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(String(raw)) as RealtimeEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.inputTranscript = "";
        this.setStatus("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        this.setStatus("transcribing");
        break;
      case "conversation.item.input_audio_transcription.delta":
        this.inputTranscript += event.delta ?? "";
        this.config?.onTranscript?.({ text: this.inputTranscript, isFinal: false });
        break;
      case "conversation.item.input_audio_transcription.completed":
      case "conversation.item.input_audio_transcription.done": {
        const transcript = event.transcript ?? this.inputTranscript;
        this.inputTranscript = transcript;
        if (transcript.trim()) this.config?.onTranscript?.({ text: transcript.trim(), isFinal: true });
        this.setStatus("thinking");
        break;
      }
      case "response.created":
        this.setStatus("thinking");
        break;
      case "response.output_audio.delta":
      case "response.output_audio_transcript.delta":
        this.setStatus("speaking");
        break;
      case "response.function_call_arguments.done":
        if (event.name === SENTINEL_REASONING_TOOL && event.call_id) {
          void this.delegateReasoning(event.call_id, event.arguments);
        }
        break;
      case "response.output_item.done":
        // The same call surfaces on two events; dispatchedCalls makes the
        // second a no-op, so a turn is never reasoned — or a tool run — twice.
        if (
          event.item?.type === "function_call" &&
          event.item.name === SENTINEL_REASONING_TOOL &&
          event.item.call_id
        ) {
          void this.delegateReasoning(event.item.call_id, event.item.arguments);
        }
        break;
      case "response.done":
        if (this.status !== "error") this.setStatus("listening");
        break;
      case "error":
        this.fail(new Error(event.error?.message || "OpenAI Realtime returned an error"));
        break;
    }
  }

  /**
   * Hands the turn to this agent's own reasoning model.
   *
   * The live model never answers substantive turns itself — it calls this,
   * and Sentinel runs the turn on the agent's runtime with its memory,
   * permissions and MCP tools. The answer comes back as the tool's output and
   * the live model speaks it, so the user hears one continuous conversation.
   */
  private async delegateReasoning(callId: string, rawArguments: string | undefined): Promise<void> {
    // Interruption and retry both re-emit the same call id. Executing twice
    // would re-run whatever tools the turn triggers, so the first wins.
    if (this.dispatchedCalls.has(callId)) return;
    this.dispatchedCalls.add(callId);
    this.setStatus("thinking");

    let request = "";
    try {
      request = String((JSON.parse(rawArguments ?? "{}") as { request?: unknown }).request ?? "");
    } catch {
      request = "";
    }
    if (!request.trim()) request = this.inputTranscript.trim();

    let output: object;
    try {
      const response = await fetch("/api/voice/reasoning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: this.agentId,
          roomId: this.config?.roomId,
          sessionId: this.telemetrySessionId,
          request,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { answer?: string; error?: string }
        | null;
      if (!response.ok || !payload?.answer) {
        throw new Error(payload?.error || "Sentinel could not answer that.");
      }
      output = { answer: payload.answer };
    } catch (error) {
      // Surfaced to the model as a spoken-able failure rather than thrown:
      // a dropped tool output leaves the live session waiting forever.
      output = {
        error: error instanceof Error ? error.message : "Sentinel could not answer that.",
      };
    }

    try {
      this.send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
      });
      this.send({ type: "response.create" });
    } catch {
      // The session closed mid-turn; nothing left to speak into.
    }
  }

  private send(event: object): void {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("OpenAI Realtime session is not active");
    }
    this.channel.send(JSON.stringify(event));
  }

  private async cleanup(): Promise<void> {
    this.channel?.close();
    this.channel = null;
    this.peer?.close();
    this.peer = null;
    for (const track of this.microphone?.getTracks() ?? []) track.stop();
    this.microphone = null;
    if (this.audio) {
      this.audio.pause();
      this.audio.srcObject = null;
      this.audio.remove();
      this.audio = null;
    }
    this.dispatchedCalls.clear();
    this.inputTranscript = "";
  }

  private fail(error: Error): void {
    this.setStatus("error");
    this.config?.onError?.(error);
  }

  private setStatus(status: VoiceStatus): void {
    this.status = status;
    this.config?.onStatusChange?.(status);
  }
}
