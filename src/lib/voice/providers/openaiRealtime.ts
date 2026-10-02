import type { VoiceProvider, VoiceProviderConfig, VoiceStatus } from "../types";

/**
 * GPT-Live voice provider (POST /v1/live/sessions, client delegation).
 *
 * The live model owns the microphone and the speaker; it never reasons for the
 * agent. When a turn needs the agent, GPT-Live emits `session.delegation.created`
 * — metadata only, no text — and this provider works out what the user asked
 * from the transcript events, runs it through Sentinel's own reasoning route,
 * and returns the result with `session.commentary.append`, which the live model
 * paraphrases aloud.
 */

interface LiveSessionResponse {
  sdp: string;
  sessionId: string | null;
  agentId: string;
  voice: string;
  voiceModel: string;
  reasoningModel: string;
}

interface LiveEvent {
  type?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  offset_ms?: number;
  event_id?: string;
  client_event_id?: string;
  error?: { message?: string };
  message?: string;
  delegation?: { id?: string; target?: string };
}

/** A slice of transcript on the session timeline. */
interface Fragment {
  start: number;
  end: number;
  text: string;
}

interface PendingDelegation {
  controller: AbortController;
  /** Where on the session timeline the delegation was raised. */
  offsetMs: number;
}

/** A commentary append carries at most 500 tokens; stay well inside that. */
const COMMENTARY_CHUNK_CHARS = 1500;
const COMMENTARY_MAX_CHUNKS = 4;
/** How long to wait for transcript fragments that trail the delegation event. */
const TRANSCRIPT_SETTLE_MS = 700;
const TRANSCRIPT_SLACK_MS = 250;
/** Output transcript silence after which the agent is no longer "speaking". */
const SPEAKING_IDLE_MS = 1500;
const CLOSE_TIMEOUT_MS = 1500;

export class OpenAIRealtimeProvider implements VoiceProvider {
  readonly name = "openai_realtime";
  private status: VoiceStatus = "idle";
  private config: VoiceProviderConfig | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private microphone: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private agentId = "";
  private telemetrySessionId: string | null = null;
  /** Delegation ids already taken up, so a repeated event cannot run a turn twice. */
  private handled = new Set<string>();
  private pending = new Map<string, PendingDelegation>();
  private inputFragments: Fragment[] = [];
  /** Timeline offset of the previous delegation: the start of the next utterance. */
  private lastDelegationOffset = -1;
  private speakingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Append events sent by us, so a rejected one is not mistaken for a dead session. */
  private outstanding = new Set<string>();
  private eventSeq = 0;
  private resolveClosed: (() => void) | null = null;
  /** Decision awaiting its first spoken output, for the TTFA measurement. */
  private awaitingFirstAudio: { decisionId: string; since: number } | null = null;

  async startSession(config: VoiceProviderConfig): Promise<void> {
    this.config = config;
    try {
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

      // GPT-Live requires this exact label.
      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.addEventListener("open", () => this.setStatus("listening"));
      channel.addEventListener("message", (event) => this.handleEvent(event.data));
      channel.addEventListener("close", () => {
        this.resolveClosed?.();
        if (this.status !== "error") this.setStatus("idle");
      });

      peer.addEventListener("connectionstatechange", () => {
        if (["failed", "disconnected"].includes(peer.connectionState)) {
          this.fail(new Error("The voice connection was lost"));
        }
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      // The offer goes to Sentinel, which exchanges it with the project key.
      // No credential, ephemeral or otherwise, is ever handed to the browser.
      const sessionResponse = await fetch("/api/voice/openai/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // No default: the caller must say which agent is speaking.
          agentId: config.agentId,
          roomId: config.roomId,
          language: config.language,
          sdp: offer.sdp,
        }),
      });
      const session = (await sessionResponse.json().catch(() => null)) as
        | (LiveSessionResponse & { error?: string })
        | null;
      if (!sessionResponse.ok || !session?.sdp) {
        throw new Error(session?.error || "Live voice is unavailable");
      }

      this.agentId = session.agentId;
      this.telemetrySessionId = session.sessionId;
      await peer.setRemoteDescription({ type: "answer", sdp: session.sdp });
    } catch (reason) {
      const error = reason instanceof Error ? reason : new Error("Live voice failed to start");
      await this.cleanup();
      this.fail(error);
      throw error;
    }
  }

  async stopSession(): Promise<void> {
    // Ask GPT-Live to close and wait for it, so billing stops and the last
    // events are not cut off; fall back to tearing down if it does not answer.
    if (this.channel?.readyState === "open") {
      const closed = new Promise<void>((resolve) => {
        this.resolveClosed = resolve;
        setTimeout(resolve, CLOSE_TIMEOUT_MS);
      });
      try {
        this.send({ type: "session.close" });
        await closed;
      } catch {
        // Already gone.
      }
    }
    await this.cleanup();
    this.setStatus("idle");
    this.config = null;
  }

  async sendAudio(): Promise<void> {
    // The microphone track is the audio path; there is nothing to push by hand.
    throw new Error("GPT-Live takes audio from the microphone, not from sendAudio()");
  }

  async sendText(text: string): Promise<void> {
    if (!text.trim()) return;
    // Typed text is context for the live model, not a turn: delegations still
    // originate from speech.
    this.sendAppend("session.thinking.append", null, `The user typed: ${text.trim()}`);
  }

  getStatus(): VoiceStatus {
    return this.status;
  }

  /**
   * Silences the microphone without ending the call. The local track is
   * disabled as well as the session muted, so no audio leaves the device even
   * if the mute command is slow to be acknowledged.
   */
  setMuted(muted: boolean): void {
    for (const track of this.microphone?.getTracks() ?? []) track.enabled = !muted;
    try {
      this.send({ type: muted ? "session.input_audio.mute" : "session.input_audio.unmute", event_id: this.nextEventId() });
    } catch {
      // No open session; the disabled track is the mute.
    }
  }

  private handleEvent(raw: unknown): void {
    let event: LiveEvent;
    try {
      event = JSON.parse(String(raw)) as LiveEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "session.input_transcript.delta": {
        const fragment = this.toFragment(event);
        if (!fragment) break;
        this.inputFragments.push(fragment);
        // The user spoke after a delegation was raised: they have moved on, so
        // the old answer must not be spoken. Compared on the session timeline,
        // because a late fragment of the *same* utterance starts before it.
        this.supersedePendingBefore(fragment.start);
        this.clearSpeakingTimer();
        this.setStatus("listening");
        this.config?.onTranscript?.({ text: this.utteranceText(this.lastDelegationOffset, Infinity), isFinal: false });
        break;
      }
      case "session.output_transcript.delta":
        this.reportFirstAudio();
        this.setStatus("speaking");
        this.armSpeakingTimer();
        break;
      case "session.delegation.created":
        if (event.delegation?.id && event.delegation.target === "client") {
          void this.delegate(event.delegation.id, event.offset_ms ?? 0);
        }
        break;
      case "session.closed":
        this.resolveClosed?.();
        break;
      case "error":
      case "session.error": {
        const ref = event.client_event_id ?? event.event_id;
        // A rejected append (too long, unknown delegation) costs us one
        // utterance, not the call.
        if (ref && this.outstanding.delete(ref)) break;
        this.fail(new Error(event.error?.message || event.message || "Live voice returned an error"));
        break;
      }
      case "session.commentary.appended":
      case "session.thinking.appended":
      case "session.instructions.appended":
        if (event.client_event_id) this.outstanding.delete(event.client_event_id);
        break;
    }
  }

  /**
   * Turns a delegation into a request for the agent's own reasoning model.
   *
   * The delegation event carries no text, so the request is rebuilt from the
   * input transcript between the previous delegation and this one.
   */
  private async delegate(delegationId: string, offsetMs: number): Promise<void> {
    // Interruption and retry both re-emit ids; running a turn twice would
    // re-run whatever tools it triggers, so the first wins.
    if (this.handled.has(delegationId)) return;
    this.handled.add(delegationId);
    this.setStatus("thinking");

    const turnStartedAt = performance.now();
    const previousOffset = this.lastDelegationOffset;
    this.lastDelegationOffset = offsetMs;

    const controller = new AbortController();
    this.pending.set(delegationId, { controller, offsetMs });

    await this.settleTranscript(offsetMs);
    if (controller.signal.aborted) return;

    const request = this.utteranceText(previousOffset, offsetMs + TRANSCRIPT_SLACK_MS)
      || this.utteranceText(previousOffset, Infinity);
    if (!request) {
      this.pending.delete(delegationId);
      this.sendAppend("session.commentary.append", delegationId, "I didn't catch that. Could you say it again?");
      return;
    }

    let answer = "";
    let decisionId: string | undefined;
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
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | { answer?: string; error?: string; decisionId?: string }
        | null;
      if (!response.ok || !payload?.answer) {
        throw new Error(payload?.error || "Sentinel could not answer that.");
      }
      answer = payload.answer;
      decisionId = payload.decisionId;
    } catch (error) {
      if (controller.signal.aborted) {
        // Superseded. Tell the live model to drop it rather than leave it
        // waiting, but never ask it to speak the stale answer.
        this.pending.delete(delegationId);
        this.sendAppend(
          "session.thinking.append",
          delegationId,
          "The user changed their request. Disregard the earlier one; do not speak a result for it.",
        );
        return;
      }
      // A spoken-able failure, not a silent one: a delegation with no result
      // leaves the live model waiting.
      answer = `I couldn't complete that. ${error instanceof Error ? error.message : "Sentinel could not answer."}`;
    }

    this.pending.delete(delegationId);
    if (controller.signal.aborted) return;
    // Measured from when the delegation arrived, so it excludes the live
    // model's own end-of-speech detection.
    if (decisionId) this.awaitingFirstAudio = { decisionId, since: turnStartedAt };
    for (const chunk of chunkForSpeech(answer)) {
      this.sendAppend("session.commentary.append", delegationId, chunk);
    }
  }

  /** Waits for transcript fragments that trail the delegation event, but never long. */
  private async settleTranscript(offsetMs: number): Promise<void> {
    const deadline = performance.now() + TRANSCRIPT_SETTLE_MS;
    while (performance.now() < deadline) {
      const covered = this.inputFragments.some((f) => f.end >= offsetMs - TRANSCRIPT_SLACK_MS);
      if (covered) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private utteranceText(afterMs: number, atMostMs: number): string {
    return this.inputFragments
      .filter((f) => f.start > afterMs && f.start <= atMostMs)
      .map((f) => f.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  }

  private toFragment(event: LiveEvent): Fragment | null {
    if (typeof event.delta !== "string" || !event.delta) return null;
    const start = event.start_ms ?? 0;
    return { start, end: event.end_ms ?? start, text: event.delta };
  }

  private supersedePendingBefore(startMs: number): void {
    for (const [id, delegation] of this.pending) {
      if (startMs > delegation.offsetMs) {
        delegation.controller.abort();
        this.pending.delete(id);
      }
    }
  }

  private abortPending(): void {
    for (const delegation of this.pending.values()) delegation.controller.abort();
    this.pending.clear();
  }

  private armSpeakingTimer(): void {
    this.clearSpeakingTimer();
    this.speakingTimer = setTimeout(() => {
      this.speakingTimer = null;
      if (this.status === "speaking") this.setStatus(this.pending.size > 0 ? "thinking" : "listening");
    }, SPEAKING_IDLE_MS);
  }

  private clearSpeakingTimer(): void {
    if (this.speakingTimer) clearTimeout(this.speakingTimer);
    this.speakingTimer = null;
  }

  /** Time from the answer being handed over to the first thing the user hears. */
  private reportFirstAudio(): void {
    const pending = this.awaitingFirstAudio;
    if (!pending) return;
    this.awaitingFirstAudio = null;
    const ttfaMs = Math.round(performance.now() - pending.since);
    void fetch("/api/voice/reasoning/trace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decisionId: pending.decisionId, ttfaMs }),
      keepalive: true,
    }).catch(() => undefined);
  }

  private nextEventId(): string {
    return `sentinel-${++this.eventSeq}`;
  }

  /** `delegationId` null is general session context; otherwise it must name a known delegation. */
  private sendAppend(
    type: "session.commentary.append" | "session.thinking.append",
    delegationId: string | null,
    content: string,
  ): void {
    const eventId = this.nextEventId();
    this.outstanding.add(eventId);
    try {
      this.send({ type, event_id: eventId, delegation_id: delegationId, content });
    } catch {
      // The session closed mid-turn; nothing left to speak into.
      this.outstanding.delete(eventId);
    }
  }

  private send(event: object): void {
    if (!this.channel || this.channel.readyState !== "open") {
      throw new Error("The voice session is not active");
    }
    this.channel.send(JSON.stringify(event));
  }

  private async cleanup(): Promise<void> {
    this.abortPending();
    this.clearSpeakingTimer();
    this.awaitingFirstAudio = null;
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
    this.handled.clear();
    this.outstanding.clear();
    this.inputFragments = [];
    this.lastDelegationOffset = -1;
    this.resolveClosed = null;
  }

  private fail(error: Error): void {
    this.setStatus("error");
    this.config?.onError?.(error);
  }

  private setStatus(next: VoiceStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.config?.onStatusChange?.(next);
  }
}

/** Splits a long answer on sentence boundaries into appends the live model can take. */
function chunkForSpeech(text: string): string[] {
  const clean = text.trim();
  if (clean.length <= COMMENTARY_CHUNK_CHARS) return [clean];
  const chunks: string[] = [];
  let rest = clean;
  while (rest.length > COMMENTARY_CHUNK_CHARS && chunks.length < COMMENTARY_MAX_CHUNKS) {
    const window = rest.slice(0, COMMENTARY_CHUNK_CHARS);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf("\n"), window.lastIndexOf("? "), window.lastIndexOf("! "));
    const end = cut > COMMENTARY_CHUNK_CHARS / 2 ? cut + 1 : COMMENTARY_CHUNK_CHARS;
    chunks.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trim();
  }
  if (rest && chunks.length < COMMENTARY_MAX_CHUNKS) chunks.push(rest);
  return chunks;
}
