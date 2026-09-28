// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { CircuitBreaker } from "@/lib/system-one/breaker";
import { JevProvider, parseJevAnswer } from "@/lib/system-one/providers/jev";
import { buildDecisionRequest } from "@/lib/system-one/questions";
import { SystemOneDecisionService } from "@/lib/system-one/service";
import type { SystemOneProvider, SystemOneProviderRequest, SystemOneProviderResponse } from "@/lib/system-one/types";
import { statusTool, testConfig } from "./fixtures";

const input = { request: "what's the operational status?", surface: "voice" as const, agentId: "hermes-nathan2", tools: [statusTool] };

/** A well-formed Jev response for whatever was asked. */
function jevAnswers(request: SystemOneProviderRequest, picks: Record<string, string> = {}) {
  const answers: Record<string, unknown> = {};
  for (const [id, q] of Object.entries(request.questions)) {
    if (q.type === "noul") answers[id] = { type: "noul", noul: 0.1 };
    else if (q.type === "choice") {
      const options = Object.keys(q.criteria);
      const choice = picks[id] ?? options[0];
      answers[id] = { type: "choice", choice, confidence: 0.9, probabilities: Object.fromEntries(options.map((o) => [o, o === choice ? 0.95 : 0.05 / (options.length - 1)])) };
    } else {
      answers[id] = { type: "score", score: 1, confidence: 0.8, legend: {}, probabilities: Object.fromEntries(q.criteria.map((_, i) => [String(i), i === 1 ? 1 : 0])) };
    }
  }
  return answers;
}

describe("JevProvider", () => {
  it("sends the whole bundle in exactly one call, to the System One endpoint", async () => {
    const request = buildDecisionRequest(input);
    const fetchImpl = vi.fn(async () => Response.json({ model: "typesafe/jev-1.13-20260917", answers: jevAnswers(request), usage: { input_tokens: 480, cost: 0.00002 } }));
    const provider = new JevProvider({ apiKey: "k", baseUrl: "https://openrouter.ai/api", model: "jev-1.13", fetchImpl: fetchImpl as unknown as typeof fetch });

    const response = await provider.evaluate(request, new AbortController().signal);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/systemone");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("jev-1.13");
    expect(Object.keys(body.questions).sort()).toEqual(Object.keys(request.questions).sort());
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k");
    expect(response.model).toBe("typesafe/jev-1.13-20260917");
    expect(response.inputTokens).toBe(480);
    expect(response.costUsd).toBe(0.00002);
  });

  it("rejects the whole bundle when any single answer is malformed", async () => {
    const request = buildDecisionRequest(input);
    const answers = jevAnswers(request);
    answers.route = { type: "choice", choice: "launch_missiles", confidence: 0.99, probabilities: {} };
    const provider = new JevProvider({ apiKey: "k", baseUrl: "https://x", model: "m", fetchImpl: (async () => Response.json({ answers })) as unknown as typeof fetch });
    await expect(provider.evaluate(request, new AbortController().signal)).rejects.toMatchObject({ kind: "malformed" });
  });

  it.each([
    ["wrong type", { type: "choice", choice: "x" }],
    ["probability out of range", { type: "noul", noul: 1.3 }],
    ["NaN", { type: "noul", noul: Number.NaN }],
    ["missing", undefined],
  ])("parseJevAnswer refuses a noul that is %s", (_label, raw) => {
    expect(parseJevAnswer({ type: "noul", instructions: "?" }, raw)).toBeNull();
  });

  it("refuses a score outside the declared levels", () => {
    expect(parseJevAnswer({ type: "score", instructions: "?", criteria: ["a", "b"] }, { type: "score", score: 2.5, confidence: 0.5, probabilities: { 0: 0, 1: 1 } })).toBeNull();
  });

  it("surfaces HTTP failures as provider errors, without retrying", async () => {
    const fetchImpl = vi.fn(async () => new Response("overloaded", { status: 529 }));
    const provider = new JevProvider({ apiKey: "k", baseUrl: "https://x", model: "m", fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(provider.evaluate(buildDecisionRequest(input), new AbortController().signal)).rejects.toMatchObject({ kind: "http", status: 529 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

function provider(impl: (req: SystemOneProviderRequest, signal: AbortSignal) => Promise<SystemOneProviderResponse>): SystemOneProvider & { evaluate: ReturnType<typeof vi.fn> } {
  return { name: "fake", evaluate: vi.fn(impl) };
}

const ok = (req: SystemOneProviderRequest): SystemOneProviderResponse => {
  const raw = jevAnswers(req, { route: "tool_read", tool: statusTool.id });
  const answers = Object.fromEntries(Object.entries(req.questions).map(([id, q]) => [id, parseJevAnswer(q, raw[id])!]));
  return { answers, model: "jev-1.13", inputTokens: 400, costUsd: 0.00002 };
};

const hang = (_: SystemOneProviderRequest, signal: AbortSignal) =>
  new Promise<SystemOneProviderResponse>((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));

describe("SystemOneDecisionService", () => {
  it("returns a decision on success", async () => {
    const service = new SystemOneDecisionService(provider(async (r) => ok(r)), testConfig());
    const result = await service.decide(input, { timeoutMs: 200 });
    expect(result.outcome).toBe("ok");
    expect(result.decision?.route).toBe("tool_read");
    expect(result.decision?.suggestedTool).toBe(statusTool.id);
  });

  it("never waits past its timeout, and reports it as a fallback", async () => {
    const service = new SystemOneDecisionService(provider(hang), testConfig());
    const started = performance.now();
    const result = await service.decide(input, { timeoutMs: 60 });
    expect(result.outcome).toBe("timeout");
    expect(result.decision).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
  });

  it("is disabled, not failed, when no provider is configured", async () => {
    const result = await new SystemOneDecisionService(null, testConfig()).decide(input, { timeoutMs: 50 });
    expect(result.outcome).toBe("disabled");
  });

  it("opens the breaker after consecutive failures and stops calling the provider", async () => {
    let now = 0;
    const failing = provider(async () => { throw new Error("boom"); });
    const service = new SystemOneDecisionService(failing, testConfig(), new CircuitBreaker(3, 10_000, () => now));
    for (let i = 0; i < 3; i += 1) expect((await service.decide(input, { timeoutMs: 50 })).outcome).toBe("error");
    expect((await service.decide(input, { timeoutMs: 50 })).outcome).toBe("circuit_open");
    expect(failing.evaluate).toHaveBeenCalledTimes(3);

    // Half-open: exactly one probe after the window; success closes it.
    now = 10_001;
    failing.evaluate.mockImplementation(async (r: SystemOneProviderRequest) => ok(r));
    expect((await service.decide(input, { timeoutMs: 50 })).outcome).toBe("ok");
    expect(service.breakerState()).toBe("closed");
  });

  it("treats a caller abort (user interrupted) as aborted, not as a provider failure", async () => {
    const breaker = new CircuitBreaker(1, 10_000);
    const service = new SystemOneDecisionService(provider(hang), testConfig(), breaker);
    const controller = new AbortController();
    const pending = service.decide(input, { timeoutMs: 1_000, signal: controller.signal });
    controller.abort();
    expect((await pending).outcome).toBe("aborted");
    expect(breaker.state()).toBe("closed");
  });

  it("maps a malformed provider answer to the malformed outcome", async () => {
    const { SystemOneProviderError } = await import("@/lib/system-one/providers/jev");
    const service = new SystemOneDecisionService(provider(async () => { throw new SystemOneProviderError("bad", "malformed"); }), testConfig());
    expect((await service.decide(input, { timeoutMs: 50 })).outcome).toBe("malformed");
  });
});
