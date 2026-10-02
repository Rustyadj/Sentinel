import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAIRealtimeProvider } from "./openaiRealtime";
import type { VoiceProviderConfig } from "../types";

type Listener = (event: { data?: string }) => void;

class FakeChannel {
  readyState = "open";
  sent: Array<Record<string, unknown>> = [];
  private listeners = new Map<string, Listener[]>();
  addEventListener(type: string, listener: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = "closed";
    this.fire("close");
  }
  fire(type: string, data?: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
  /** Delivers a server event as the data channel would. */
  emit(event: object) {
    this.fire("message", JSON.stringify(event));
  }
  appends(type: string) {
    return this.sent.filter((event) => event.type === type);
  }
}

let channel: FakeChannel;
const track = { enabled: true, stop: vi.fn() };

class FakePeer {
  connectionState = "connected";
  remoteAnswer: string | undefined;
  ontrack: unknown = null;
  addTrack() {}
  addEventListener() {}
  createDataChannel(label: string) {
    expect(label).toBe("oai-events");
    channel = new FakeChannel();
    return channel;
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" };
  }
  async setLocalDescription() {}
  async setRemoteDescription(description: { sdp: string }) {
    this.remoteAnswer = description.sdp;
  }
  close() {}
}

type FetchHandler = (url: string, init: RequestInit) => Promise<Response> | Response;
let fetchMock: ReturnType<typeof vi.fn>;
let routes: { session: FetchHandler; reasoning: FetchHandler };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function reasoningCalls() {
  return fetchMock.mock.calls.filter(([url]) => url === "/api/voice/reasoning");
}

async function startProvider(overrides: Partial<VoiceProviderConfig> = {}) {
  const provider = new OpenAIRealtimeProvider();
  const config: VoiceProviderConfig = {
    agentId: "hermes-lisa",
    roomId: "room-1",
    onStatusChange: vi.fn(),
    onTranscript: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
  await provider.startSession(config);
  return { provider, config };
}

/** User speech as GPT-Live reports it: fragments placed on the session timeline. */
function say(text: string, start: number, end: number) {
  channel.emit({ type: "session.input_transcript.delta", delta: text, start_ms: start, end_ms: end });
}

function delegate(id: string, offsetMs: number) {
  channel.emit({ type: "session.delegation.created", offset_ms: offsetMs, delegation: { id, type: "delegation", target: "client" } });
}

beforeEach(() => {
  // jsdom does not implement media playback; the provider only needs it not to throw.
  HTMLMediaElement.prototype.pause = () => {};
  track.enabled = true;
  track.stop.mockClear();
  routes = {
    session: () => json({ sdp: "v=0 answer", sessionId: "telemetry-1", agentId: "hermes-lisa", voice: "gleam", voiceModel: "gpt-live-1", reasoningModel: "m" }),
    reasoning: () => json({ answer: "You have two meetings.", decisionId: "decision-1" }),
  };
  fetchMock = vi.fn((url: string, init: RequestInit) => {
    if (url === "/api/voice/openai/session") return Promise.resolve(routes.session(url, init));
    if (url === "/api/voice/reasoning") return Promise.resolve(routes.reasoning(url, init));
    return Promise.resolve(json({}));
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("RTCPeerConnection", FakePeer);
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [track] }) },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAIRealtimeProvider (GPT-Live, client delegation)", () => {
  it("sends its offer to Sentinel, never to OpenAI, and goes live on the channel opening", async () => {
    const { config } = await startProvider();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/voice/openai/session");
    expect(JSON.parse(init.body as string)).toMatchObject({ agentId: "hermes-lisa", roomId: "room-1", sdp: "v=0 offer" });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("openai.com"))).toBe(false);

    channel.fire("open");
    expect(config.onStatusChange).toHaveBeenCalledWith("listening");
  });

  it("rebuilds the request from the transcript and returns the answer as commentary", async () => {
    const { config } = await startProvider();
    say("What's on ", 0, 400);
    say("my calendar?", 400, 1000);
    delegate("del-1", 1000);

    await vi.waitFor(() => expect(channel.appends("session.commentary.append")).toHaveLength(1));
    expect(JSON.parse(reasoningCalls()[0][1].body as string)).toMatchObject({
      agentId: "hermes-lisa",
      roomId: "room-1",
      sessionId: "telemetry-1",
      request: "What's on my calendar?",
    });
    expect(channel.appends("session.commentary.append")[0]).toMatchObject({
      delegation_id: "del-1",
      content: "You have two meetings.",
    });
    expect(config.onStatusChange).toHaveBeenCalledWith("thinking");
  });

  it("waits briefly for transcript fragments that trail the delegation event", async () => {
    await startProvider();
    delegate("del-1", 1000);
    setTimeout(() => say("book Thursday", 200, 1000), 120);

    await vi.waitFor(() => expect(reasoningCalls()).toHaveLength(1));
    expect(JSON.parse(reasoningCalls()[0][1].body as string).request).toBe("book Thursday");
  });

  it("gives each delegation only its own utterance", async () => {
    await startProvider();
    say("first question", 0, 900);
    delegate("del-1", 1000);
    await vi.waitFor(() => expect(channel.appends("session.commentary.append")).toHaveLength(1));

    say("second question", 5000, 5900);
    delegate("del-2", 6000);
    await vi.waitFor(() => expect(channel.appends("session.commentary.append")).toHaveLength(2));
    expect(JSON.parse(reasoningCalls()[1][1].body as string).request).toBe("second question");
  });

  it("runs a repeated delegation event once", async () => {
    await startProvider();
    say("hello there", 0, 900);
    delegate("del-1", 1000);
    delegate("del-1", 1000);

    await vi.waitFor(() => expect(channel.appends("session.commentary.append")).toHaveLength(1));
    expect(reasoningCalls()).toHaveLength(1);
  });

  it("drops a pending answer when the user speaks over it, and says nothing for it", async () => {
    let aborted = false;
    routes.reasoning = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    await startProvider();
    say("old request", 0, 900);
    delegate("del-1", 1000);
    await vi.waitFor(() => expect(reasoningCalls()).toHaveLength(1));

    // New speech that starts after the delegation was raised.
    say("actually, never mind", 1800, 2600);

    await vi.waitFor(() => expect(aborted).toBe(true));
    await vi.waitFor(() => expect(channel.appends("session.thinking.append")).toHaveLength(1));
    expect(channel.appends("session.commentary.append")).toHaveLength(0);
  });

  it("does not mistake a late fragment of the same utterance for the user moving on", async () => {
    let release: (response: Response) => void = () => {};
    routes.reasoning = () => new Promise<Response>((resolve) => { release = resolve; });
    await startProvider();
    say("what time is it", 0, 900);
    delegate("del-1", 1000);
    await vi.waitFor(() => expect(reasoningCalls()).toHaveLength(1));

    say(" please", 900, 990); // starts before the delegation offset
    release(json({ answer: "It is noon.", decisionId: "d" }));

    await vi.waitFor(() => expect(channel.appends("session.commentary.append")).toHaveLength(1));
    expect(channel.appends("session.commentary.append")[0].content).toBe("It is noon.");
  });

  it("speaks a failure instead of leaving the live model waiting", async () => {
    routes.reasoning = () => json({ error: "runtime offline" }, 502);
    await startProvider();
    say("do the thing", 0, 900);
    delegate("del-1", 1000);

    await vi.waitFor(() => expect(channel.appends("session.commentary.append")).toHaveLength(1));
    expect(String(channel.appends("session.commentary.append")[0].content)).toContain("runtime offline");
  });

  it("asks the user to repeat when nothing was heard", async () => {
    await startProvider();
    delegate("del-1", 1000);

    await vi.waitFor(() => expect(channel.appends("session.commentary.append")).toHaveLength(1), { timeout: 2000 });
    expect(reasoningCalls()).toHaveLength(0);
    expect(String(channel.appends("session.commentary.append")[0].content)).toMatch(/say it again/i);
  });

  it("splits a long answer into appends under the per-append limit", async () => {
    const sentence = "The deployment finished without errors. ";
    routes.reasoning = () => json({ answer: sentence.repeat(120), decisionId: "d" });
    await startProvider();
    say("status", 0, 900);
    delegate("del-1", 1000);

    await vi.waitFor(() => expect(channel.appends("session.commentary.append").length).toBeGreaterThan(1));
    const chunks = channel.appends("session.commentary.append");
    expect(chunks.length).toBeLessThanOrEqual(4);
    for (const chunk of chunks) {
      expect(String(chunk.content).length).toBeLessThanOrEqual(1500);
      expect(chunk.delegation_id).toBe("del-1");
    }
  });

  it("ignores delegations that are not for the client", async () => {
    await startProvider();
    say("hello", 0, 900);
    channel.emit({ type: "session.delegation.created", offset_ms: 1000, delegation: { id: "r-1", target: "responses" } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(reasoningCalls()).toHaveLength(0);
  });

  it("shows the agent speaking, then listening again", async () => {
    vi.useFakeTimers();
    try {
      const { config } = await startProvider();
      channel.emit({ type: "session.output_transcript.delta", delta: "Hi", start_ms: 0, end_ms: 200 });
      expect(config.onStatusChange).toHaveBeenLastCalledWith("speaking");
      vi.advanceTimersByTime(1600);
      expect(config.onStatusChange).toHaveBeenLastCalledWith("listening");
    } finally {
      vi.useRealTimers();
    }
  });

  it("mutes by disabling the local track and telling GPT-Live", async () => {
    const { provider } = await startProvider();
    provider.setMuted(true);
    expect(track.enabled).toBe(false);
    expect(channel.sent.at(-1)).toMatchObject({ type: "session.input_audio.mute" });
    provider.setMuted(false);
    expect(track.enabled).toBe(true);
    expect(channel.sent.at(-1)).toMatchObject({ type: "session.input_audio.unmute" });
  });

  it("closes the session politely and releases the microphone", async () => {
    const { provider } = await startProvider();
    const stopping = provider.stopSession();
    await vi.waitFor(() => expect(channel.sent.some((event) => event.type === "session.close")).toBe(true));
    channel.emit({ type: "session.closed" });
    await stopping;
    expect(track.stop).toHaveBeenCalled();
    expect(provider.getStatus()).toBe("idle");
  });

  it("keeps the call alive when one of its own appends is rejected, but not on other errors", async () => {
    const { config } = await startProvider();
    say("hi", 0, 900);
    delegate("del-1", 1000);
    await vi.waitFor(() => expect(channel.appends("session.commentary.append")).toHaveLength(1));

    channel.emit({ type: "error", client_event_id: channel.appends("session.commentary.append")[0].event_id, error: { message: "too long" } });
    expect(config.onError).not.toHaveBeenCalled();

    channel.emit({ type: "error", error: { message: "session expired" } });
    expect(config.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "session expired" }));
  });

  it("fails cleanly, and frees the microphone, when Sentinel refuses the session", async () => {
    routes.session = () => json({ error: "The live voice layer is not configured on this deployment" }, 503);
    const provider = new OpenAIRealtimeProvider();
    const onError = vi.fn();
    await expect(provider.startSession({ agentId: "hermes-lisa", onError })).rejects.toThrow(/not configured/);
    expect(onError).toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalled();
    expect(provider.getStatus()).toBe("error");
  });
});
