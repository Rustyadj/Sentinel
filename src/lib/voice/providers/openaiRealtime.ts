import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "../types";
import { OPENAI_REALTIME_ESCALATION_TOOL } from "../openai-realtime-config";

interface RealtimeSessionResponse {
  clientSecret: string;
  model: string;
  escalationModel: string;
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  error?: { message?: string };
  name?: string;
  call_id?: string;
  item?: {
    type?: string;
    name?: string;
    call_id?: string;
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
  private miniModel = "";
  private escalationModel = "";
  private escalated = false;
  private escalatedResponseStarted = false;
  private inputTranscript = "";

  async startSession(config: VoiceProviderConfig): Promise<void> {
    this.config = config;
    try {
      const tokenResponse = await fetch("/api/voice/openai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: config.agentId || "hermes-lisa",
          roomId: config.roomId,
          language: config.language,
        }),
      });
      const token = await tokenResponse.json().catch(() => null) as (RealtimeSessionResponse & { error?: string }) | null;
      if (!tokenResponse.ok || !token?.clientSecret) {
        throw new Error(token?.error || "OpenAI Realtime is unavailable");
      }

      this.miniModel = token.model;
      this.escalationModel = token.escalationModel;
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
        if (this.escalated) this.escalatedResponseStarted = true;
        this.setStatus("thinking");
        break;
      case "response.output_audio.delta":
      case "response.output_audio_transcript.delta":
        this.setStatus("speaking");
        break;
      case "response.function_call_arguments.done":
        if (event.name === OPENAI_REALTIME_ESCALATION_TOOL && event.call_id) {
          this.escalate(event.call_id);
        }
        break;
      case "response.output_item.done":
        if (
          event.item?.type === "function_call" &&
          event.item.name === OPENAI_REALTIME_ESCALATION_TOOL &&
          event.item.call_id
        ) {
          this.escalate(event.item.call_id);
        }
        break;
      case "response.done":
        if (this.escalated && this.escalatedResponseStarted) {
          this.escalated = false;
          this.escalatedResponseStarted = false;
          this.send({
            type: "session.update",
            session: { type: "realtime", model: this.miniModel, tool_choice: "auto" },
          });
        }
        if (this.status !== "error") this.setStatus("listening");
        break;
      case "error":
        this.fail(new Error(event.error?.message || "OpenAI Realtime returned an error"));
        break;
    }
  }

  private escalate(callId: string): void {
    if (this.escalated) return;
    this.escalated = true;
    this.escalatedResponseStarted = false;
    this.setStatus("thinking");
    this.send({
      type: "session.update",
      session: { type: "realtime", model: this.escalationModel, tool_choice: "none" },
    });
    this.send({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ switched: true, model: this.escalationModel }),
      },
    });
    this.send({
      type: "response.create",
      response: {
        instructions: "Answer the current user turn with the required deeper reasoning. Do not call the escalation tool again.",
      },
    });
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
    this.escalated = false;
    this.escalatedResponseStarted = false;
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
