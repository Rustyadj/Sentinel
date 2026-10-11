import type WebSocket from "ws";
import { logger } from "@/lib/logger";
import type { AgentVoiceConfig } from "@/lib/voice/agent-voice-config";
import { GptLiveSession, type LiveEvent, type LiveSessionOptions } from "./live-session";
import { openingInstruction, phoneSessionInstructions, wrapCallerRequest, type PhoneCallContext } from "./instructions";
import { chunkForSpeech, FragmentLog, TurnRecorder, type RecordedTurn } from "./transcript";

/** Caller speech is dropped (not queued forever) if GPT-Live is unreachable for longer than this. */
const MAX_PREBUFFER_CHUNKS = 250; // ~5 s of 20 ms frames
const TRANSCRIPT_SETTLE_MS = 700;
const TRANSCRIPT_SLACK_MS = 250;
/** Output audio newer than this is still in Telnyx's playout queue, so speech over it is a barge-in. */
const PLAYOUT_WINDOW_MS = 2_500;
/** Ignore one-word backchannels ("mm-hm") rather than cutting the agent off. */
const BARGE_IN_MIN_CHARS = 6;
const IDLE_MEDIA_TIMEOUT_MS = 30_000;
const MAX_LIVE_RECONNECTS = 2;

export interface BridgeDeps {
  callId: string;
  voice: AgentVoiceConfig;
  context: PhoneCallContext;
  telnyx: WebSocket;
  live: LiveSessionOptions;
  maxCallSeconds: number;
  /** Runs one turn on the agent's own runtime (memory, tools, permissions). */
  runTurn: (request: string, signal: AbortSignal) => Promise<{ answer: string; toolCalls: number }>;
  onTurn: (turn: RecordedTurn) => void;
  /** Ends the phone leg through Telnyx Call Control. */
  hangup: () => Promise<void>;
  onFinished: (result: { liveSessionId: string | null; liveSeconds: number; toolCalls: number; reason: string; turns: RecordedTurn[] }) => void;
}

/**
 * Binds one phone call to one GPT-Live session and one Hermes agent.
 *
 *   Telnyx media ⇄ (μ-law passthrough) ⇄ GPT-Live ⇄ delegation ⇄ agent runtime
 *
 * All state is per instance, so concurrent calls cannot see each other.
 */
export class CallBridge {
  private live: GptLiveSession | null = null;
  private liveSessionId: string | null = null;
  private liveSeconds = 0;
  private countedSession: GptLiveSession | null = null;
  private prebuffer: string[] = [];
  private liveReady = false;
  private finished = false;
  private reconnects = 0;
  private lastOutputAt = 0;
  private lastInboundAt = Date.now();
  private toolCalls = 0;
  private handled = new Set<string>();
  private pending = new Map<string, { controller: AbortController; offsetMs: number }>();
  private fragments = new FragmentLog();
  private lastDelegationOffset = -1;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly recorder: TurnRecorder;

  constructor(private readonly deps: BridgeDeps) {
    this.recorder = new TurnRecorder((turn) => deps.onTurn(turn));
  }

  start(): void {
    const { telnyx } = this.deps;
    telnyx.on("message", (raw) => this.onTelnyxMessage(String(raw)));
    telnyx.on("close", () => void this.finish("remote_hangup"));
    telnyx.on("error", () => void this.finish("telnyx_socket_error"));

    this.idleTimer = setInterval(() => {
      if (Date.now() - this.lastInboundAt > IDLE_MEDIA_TIMEOUT_MS) void this.finish("media_timeout", true);
    }, 5_000);
    this.maxTimer = setTimeout(() => void this.finish("max_duration", true), this.deps.maxCallSeconds * 1_000);
    void this.connectLive(false);
  }

  private async connectLive(isReconnect: boolean): Promise<void> {
    const { voice, context } = this.deps;
    const session = new GptLiveSession(this.deps.live, {
      onEvent: (event) => this.onLiveEvent(session, event),
      onClose: (cleanly) => this.onLiveClosed(session, cleanly),
    });
    this.live = session;
    try {
      this.liveSessionId = await session.connect({
        model: voice.voiceModel,
        voice: voice.voice,
        instructions: phoneSessionInstructions(voice, context),
        history: isReconnect
          ? this.recorder.turns.map((t) => ({ role: t.role === "caller" ? ("user" as const) : ("assistant" as const), text: t.text }))
          : undefined,
      });
    } catch (error) {
      logger.error("telephony.live_connect_failed", { callId: this.deps.callId, error: String(error) });
      await this.finish("live_unavailable", true);
      return;
    }

    this.liveReady = true;
    for (const chunk of this.prebuffer.splice(0)) session.appendAudio(chunk);
    if (!isReconnect) {
      // The greeting is an instruction, not a transcript: keep audio flowing while it is spoken.
      session.send({
        type: "session.instructions.append",
        event_id: session.nextEventId(),
        delegation_id: null,
        content: openingInstruction(voice, context),
      });
    }
  }

  private onLiveClosed(session: GptLiveSession, cleanly: boolean): void {
    if (this.finished || session !== this.live) return;
    this.liveSeconds += session.usageSeconds;
    this.countedSession = session;
    this.liveReady = false;
    this.abortPending();
    if (cleanly || this.reconnects >= MAX_LIVE_RECONNECTS) {
      void this.finish(cleanly ? "live_closed" : "live_connection_lost", true);
      return;
    }
    this.reconnects += 1;
    logger.warn("telephony.live_reconnecting", { callId: this.deps.callId, attempt: this.reconnects });
    void this.connectLive(true);
  }

  private onTelnyxMessage(raw: string): void {
    let message: { event?: string; media?: { payload?: string; track?: string }; error?: unknown };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    switch (message.event) {
      case "media": {
        const payload = message.media?.payload;
        if (!payload) return;
        this.lastInboundAt = Date.now();
        if (this.liveReady && this.live) this.live.appendAudio(payload);
        else if (this.prebuffer.length < MAX_PREBUFFER_CHUNKS) this.prebuffer.push(payload);
        return;
      }
      case "stop":
        void this.finish("remote_hangup");
        return;
      case "error":
        logger.warn("telephony.telnyx_stream_error", { callId: this.deps.callId });
        return;
    }
  }

  private sendToTelnyx(message: object): void {
    if (this.deps.telnyx.readyState === 1) this.deps.telnyx.send(JSON.stringify(message));
  }

  private onLiveEvent(session: GptLiveSession, event: LiveEvent): void {
    if (session !== this.live || this.finished) return;
    switch (event.type) {
      case "session.output_audio.delta":
        if (event.delta) {
          this.lastOutputAt = Date.now();
          this.sendToTelnyx({ event: "media", media: { payload: event.delta } });
        }
        break;
      case "session.output_transcript.delta":
        if (event.delta) this.recorder.push("agent", event.delta, event.start_ms ?? 0);
        break;
      case "session.input_transcript.delta": {
        if (!event.delta) break;
        const start = event.start_ms ?? 0;
        this.fragments.add({ start, end: event.end_ms ?? start, text: event.delta });
        this.recorder.push("caller", event.delta, start);
        this.supersedePendingBefore(start);
        // Barge-in: the caller is talking over audio still queued at Telnyx.
        if (Date.now() - this.lastOutputAt < PLAYOUT_WINDOW_MS && event.delta.trim().length >= BARGE_IN_MIN_CHARS) {
          this.sendToTelnyx({ event: "clear" });
          this.lastOutputAt = 0;
        }
        break;
      }
      case "session.delegation.created":
        if (event.delegation?.id && event.delegation.target === "client") {
          void this.delegate(session, event.delegation.id, event.offset_ms ?? 0);
        }
        break;
      case "error":
        logger.warn("telephony.live_error", { callId: this.deps.callId, message: event.error?.message?.slice(0, 200) });
        break;
    }
  }

  private async delegate(session: GptLiveSession, delegationId: string, offsetMs: number): Promise<void> {
    // Re-emitted ids must not re-run a turn: the first would already have run its tools.
    if (this.handled.has(delegationId)) return;
    this.handled.add(delegationId);

    const previousOffset = this.lastDelegationOffset;
    this.lastDelegationOffset = offsetMs;
    const controller = new AbortController();
    this.pending.set(delegationId, { controller, offsetMs });

    if (this.deps.context.trust === "screened") {
      this.pending.delete(delegationId);
      this.append(session, "session.commentary.append", delegationId, "I can only take a message. Please tell me your name, number and what this is about.");
      return;
    }

    const deadline = Date.now() + TRANSCRIPT_SETTLE_MS;
    while (Date.now() < deadline && !this.fragments.covers(offsetMs, TRANSCRIPT_SLACK_MS)) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (controller.signal.aborted) return;

    const request =
      this.fragments.utterance(previousOffset, offsetMs + TRANSCRIPT_SLACK_MS) || this.fragments.utterance(previousOffset, Infinity);
    if (!request) {
      this.pending.delete(delegationId);
      this.append(session, "session.commentary.append", delegationId, "I didn't catch that. Could you say it again?");
      return;
    }

    let answer: string;
    try {
      const result = await this.deps.runTurn(wrapCallerRequest(request, this.deps.context), controller.signal);
      this.toolCalls += result.toolCalls;
      answer = result.answer;
    } catch (error) {
      if (controller.signal.aborted) {
        this.pending.delete(delegationId);
        this.append(session, "session.thinking.append", delegationId, "The caller changed their request. Disregard the earlier one; do not speak a result for it.");
        return;
      }
      logger.error("telephony.turn_failed", { callId: this.deps.callId, error: String(error) });
      answer = "Sorry, I ran into a problem with that. Could you say it again?";
    }

    this.pending.delete(delegationId);
    if (controller.signal.aborted) return;
    for (const chunk of chunkForSpeech(answer || "I don't have an answer for that yet.")) {
      this.append(session, "session.commentary.append", delegationId, chunk);
    }
  }

  private append(session: GptLiveSession, type: string, delegationId: string, content: string): void {
    try {
      session.send({ type, event_id: session.nextEventId(), delegation_id: delegationId, content });
    } catch {
      // Session closed mid-turn; nothing left to speak into.
    }
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

  /** Idempotent teardown: close GPT-Live, optionally end the phone leg, report the outcome once. */
  async finish(reason: string, endPhoneLeg = false): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (this.idleTimer) clearInterval(this.idleTimer);
    if (this.maxTimer) clearTimeout(this.maxTimer);
    this.abortPending();
    this.recorder.flush();

    const live = this.live;
    if (live) {
      await live.close().catch(() => {});
      if (live !== this.countedSession) this.liveSeconds += live.usageSeconds;
    }
    if (endPhoneLeg) await this.deps.hangup().catch((error) => logger.warn("telephony.hangup_failed", { callId: this.deps.callId, error: String(error) }));
    if (this.deps.telnyx.readyState <= 1) this.deps.telnyx.close();

    this.deps.onFinished({
      liveSessionId: this.liveSessionId,
      liveSeconds: this.liveSeconds,
      toolCalls: this.toolCalls,
      reason,
      turns: this.recorder.turns,
    });
  }
}
