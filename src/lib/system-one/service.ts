/**
 * SystemOneDecisionService — the one seam the rest of Sentinel calls. Nothing
 * outside `src/lib/system-one/` knows which provider is behind it.
 *
 * Contract: `decide()` never throws and never outlives its timeout. Every
 * failure — no key, timeout, HTTP error, malformed answer, open breaker, or the
 * caller aborting because the user interrupted — comes back as a result with
 * `decision: null`, which the policy maps to today's routing. System 1 can make
 * a request faster; it can never make one fail or be slower than the timeout.
 */
import { CircuitBreaker } from "./breaker";
import { resolveSystemOneConfig, type SystemOneConfig } from "./config";
import { JevProvider, SystemOneProviderError } from "./providers/jev";
import { buildDecisionRequest, interpretAnswers, type DecisionInput } from "./questions";
import type { SystemOneOutcome, SystemOneProvider, SystemOneResult } from "./types";

export class SystemOneDecisionService {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly provider: SystemOneProvider | null,
    private readonly config: SystemOneConfig,
    breaker?: CircuitBreaker,
  ) {
    this.breaker = breaker ?? new CircuitBreaker(config.breaker.failureThreshold, config.breaker.openMs);
  }

  get providerName(): string {
    return this.provider?.name ?? "none";
  }

  breakerState() {
    return this.breaker.state();
  }

  async decide(input: DecisionInput, options: { timeoutMs: number; signal?: AbortSignal }): Promise<SystemOneResult> {
    const startedAt = performance.now();
    const result = (outcome: SystemOneOutcome, extra: Partial<SystemOneResult> = {}): SystemOneResult => ({
      outcome,
      decision: null,
      provider: this.providerName,
      providerModel: null,
      latencyMs: Math.round(performance.now() - startedAt),
      inputTokens: 0,
      costUsd: null,
      ...extra,
    });

    if (!this.provider) return result("disabled", { error: "no System 1 provider configured" });
    if (options.signal?.aborted) return result("aborted");
    if (!this.breaker.allow()) return result("circuit_open");

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, options.timeoutMs);
    const onCallerAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      const response = await this.provider.evaluate(buildDecisionRequest(input), controller.signal);
      this.breaker.success();
      return result("ok", {
        decision: interpretAnswers(input, response.answers),
        providerModel: response.model,
        inputTokens: response.inputTokens,
        costUsd: response.costUsd,
      });
    } catch (error) {
      if (options.signal?.aborted && !timedOut) {
        // The caller gave up (user interrupted). Not the provider's fault.
        return result("aborted");
      }
      this.breaker.failure();
      if (timedOut) return result("timeout");
      const message = error instanceof Error ? error.message.slice(0, 240) : "System One call failed";
      if (error instanceof SystemOneProviderError && error.kind === "malformed") return result("malformed", { error: message });
      return result("error", { error: message });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onCallerAbort);
    }
  }
}

let shared: { service: SystemOneDecisionService; config: SystemOneConfig } | null = null;

/** Process-wide service: one breaker, one keep-alive connection pool. */
export function getSystemOne(): { service: SystemOneDecisionService; config: SystemOneConfig } {
  if (shared) return shared;
  const config = resolveSystemOneConfig();
  const provider = config.apiKey
    ? new JevProvider({ apiKey: config.apiKey, baseUrl: config.baseUrl, model: config.model })
    : null;
  shared = { service: new SystemOneDecisionService(provider, config), config };
  return shared;
}

/** Test seam. */
export function resetSystemOneForTests(next: { service: SystemOneDecisionService; config: SystemOneConfig } | null = null) {
  shared = next;
}
