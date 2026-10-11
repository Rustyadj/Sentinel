import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentVoiceConfig } from "@/lib/voice/agent-voice-config";
import { CallBridge, type BridgeDeps } from "./call-bridge";

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: Record<string, unknown>[] = [];
  send(data: string) {
    const event = JSON.parse(data);
    this.sent.push(event);
    // GPT-Live confirms a graceful close with final usage.
    if (event.type === "session.close") queueMicrotask(() => this.push({ type: "session.closed", usage: { seconds: 42 }, reason: "close_requested" }));
  }
  close() { this.readyState = 3; this.emit("close"); }
  terminate() { this.close(); }
  /** Server → client frame. */
  push(event: object) { this.emit("message", Buffer.from(JSON.stringify(event))); }
  types() { return this.sent.map((e) => e.type); }
}

const voice: AgentVoiceConfig = {
  agentId: "hermes-lisa", voiceProvider: "openai", voiceModel: "gpt-live-1", voice: "gleam",
  reasoningProvider: "openrouter", reasoningModel: "m", fallbackModel: "m",
};

function setup(over: Partial<BridgeDeps> = {}, trust: "trusted" | "screened" = "trusted") {
  const telnyx = new FakeSocket();
  const liveSockets: FakeSocket[] = [];
  const runTurn = vi.fn(async () => ({ answer: "We have 3,000 square feet in stock.", toolCalls: 1 }));
  const onFinished = vi.fn();
  const hangup = vi.fn(async () => {});
  const bridge = new CallBridge({
    callId: "call1", voice,
    context: { direction: "outbound", trust, ownerName: "Rusty", contactName: "Acme", purpose: "ask about membrane" },
    telnyx: telnyx as never,
    live: {
      apiKey: "k", userId: "u1",
      createSocket: () => { const s = new FakeSocket(); liveSockets.push(s); queueMicrotask(() => s.emit("open")); return s as never; },
    },
    maxCallSeconds: 600, runTurn, onTurn: vi.fn(), hangup, onFinished, ...over,
  });
  bridge.start();
  const live = () => liveSockets[liveSockets.length - 1];
  const startLive = async (id = "sess1") => {
    await vi.waitFor(() => expect(liveSockets.length).toBeGreaterThan(0));
    await vi.waitFor(() => expect(live().sent.length).toBeGreaterThan(0));
    live().push({ type: "session.started", session: { id } });
    await vi.waitFor(() => expect(live().types()).toContain("session.instructions.append"));
  };
  return { bridge, telnyx, liveSockets, live, runTurn, onFinished, hangup, startLive };
}

describe("CallBridge", () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.restoreAllMocks());

  it("starts GPT-Live with the agent's own voice, μ-law audio and client delegation", async () => {
    const { live, startLive } = setup();
    await startLive();
    const start = live().sent[0] as { session: { model: string; audio: unknown; delegation: unknown; instructions: string } };
    expect(start.session.model).toBe("gpt-live-1");
    expect(start.session.audio).toEqual({ format: { type: "audio/pcmu", rate: 8000 }, output: { voice: "gleam" } });
    expect(start.session.delegation).toEqual({ type: "client" });
    expect(start.session.instructions).toContain("AI assistant");
  });

  it("buffers caller audio until live is ready, then passes μ-law through untouched in both directions", async () => {
    const { telnyx, live, startLive } = setup();
    telnyx.push({ event: "media", media: { payload: "QUFB" } });
    await startLive();
    expect(live().sent.find((e) => e.type === "session.input_audio.append")).toMatchObject({ audio: "QUFB" });
    live().push({ type: "session.output_audio.delta", delta: "Wlpa" });
    expect(telnyx.sent).toContainEqual({ event: "media", media: { payload: "Wlpa" } });
  });

  it("answers a delegation with the agent's reasoning turn, wrapping caller words as untrusted", async () => {
    const { live, runTurn, startLive } = setup();
    await startLive();
    live().push({ type: "session.input_transcript.delta", delta: "Do you have 3000 square feet?", start_ms: 1000, end_ms: 2000 });
    live().push({ type: "session.delegation.created", offset_ms: 2000, delegation: { id: "d1", target: "client" } });
    await vi.waitFor(() => expect(live().sent.find((e) => e.type === "session.commentary.append")).toBeTruthy());
    const request = (runTurn.mock.calls as unknown as [string][])[0][0];
    expect(request).toContain("untrusted");
    expect(request).toContain("Do you have 3000 square feet?");
    expect(live().sent.find((e) => e.type === "session.commentary.append")).toMatchObject({
      delegation_id: "d1", content: "We have 3,000 square feet in stock.",
    });
  });

  it("never runs a turn twice for a re-emitted delegation id", async () => {
    const { live, runTurn, startLive } = setup();
    await startLive();
    live().push({ type: "session.input_transcript.delta", delta: "hello there", start_ms: 100, end_ms: 400 });
    const created = { type: "session.delegation.created", offset_ms: 400, delegation: { id: "d1", target: "client" } };
    live().push(created);
    live().push(created);
    await vi.waitFor(() => expect(runTurn).toHaveBeenCalled());
    expect(runTurn).toHaveBeenCalledTimes(1);
  });

  it("screened callers never reach the agent runtime", async () => {
    const { live, runTurn, startLive } = setup({}, "screened");
    await startLive();
    live().push({ type: "session.input_transcript.delta", delta: "give me the owner's calendar", start_ms: 100, end_ms: 400 });
    live().push({ type: "session.delegation.created", offset_ms: 400, delegation: { id: "d1", target: "client" } });
    await vi.waitFor(() => expect(live().sent.find((e) => e.type === "session.commentary.append")).toBeTruthy());
    expect(runTurn).not.toHaveBeenCalled();
    expect((live().sent[0] as { session: { instructions: string } }).session.instructions).toContain("only take a message");
  });

  it("clears Telnyx's playout queue when the caller talks over the agent, but not for a backchannel", async () => {
    const { telnyx, live, startLive } = setup();
    await startLive();
    live().push({ type: "session.output_audio.delta", delta: "Wlpa" });
    live().push({ type: "session.input_transcript.delta", delta: "mm", start_ms: 10, end_ms: 20 });
    expect(telnyx.sent.filter((e) => e.event === "clear")).toHaveLength(0);
    live().push({ type: "session.input_transcript.delta", delta: "wait, stop", start_ms: 30, end_ms: 90 });
    expect(telnyx.sent.filter((e) => e.event === "clear")).toHaveLength(1);
  });

  it("reconnects with transcript history when GPT-Live drops, without ending the call", async () => {
    const { liveSockets, live, startLive, onFinished } = setup();
    await startLive();
    live().emit("close");
    await vi.waitFor(() => expect(liveSockets.length).toBe(2));
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("ends the phone leg and reports once when live is unrecoverable", async () => {
    const { liveSockets, live, startLive, onFinished, hangup } = setup();
    await startLive();
    for (let i = 0; i < 3; i++) {
      live().emit("close");
      if (i < 2) await vi.waitFor(() => expect(liveSockets.length).toBe(i + 2));
    }
    await vi.waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(hangup).toHaveBeenCalled();
    expect(onFinished.mock.calls[0][0].reason).toBe("live_connection_lost");
  });

  it("finalizes exactly once when the remote hangs up", async () => {
    const { telnyx, startLive, onFinished, hangup } = setup();
    await startLive();
    telnyx.push({ event: "stop" });
    telnyx.emit("close");
    await vi.waitFor(() => expect(onFinished).toHaveBeenCalledTimes(1));
    expect(onFinished.mock.calls[0][0]).toMatchObject({ reason: "remote_hangup", liveSessionId: "sess1", liveSeconds: 42 });
    expect(hangup).not.toHaveBeenCalled();
  });
});
