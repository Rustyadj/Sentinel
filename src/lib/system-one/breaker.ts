/**
 * Consecutive-failure circuit breaker. While open, System 1 is skipped outright
 * so a degraded provider costs nothing — not even the timeout — until a single
 * half-open probe succeeds.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;

  constructor(
    private readonly failureThreshold: number,
    private readonly openMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True if a call may proceed. In half-open state only one probe is let through. */
  allow(): boolean {
    if (this.openedAt === null) return true;
    if (this.now() - this.openedAt < this.openMs) return false;
    if (this.probing) return false;
    this.probing = true;
    return true;
  }

  success(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probing = false;
  }

  failure(): void {
    this.probing = false;
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openedAt = this.now();
  }

  state(): "closed" | "open" | "half_open" {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt < this.openMs ? "open" : "half_open";
  }
}
