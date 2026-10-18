import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SystemOnePanel } from "@/modules/mission-control/components/SystemOnePanel";
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("System-1 Mission Control", () => {
  it("reports unavailable metrics as an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    render(<SystemOnePanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Routing metrics unavailable");
  });
  it("labels unmeasured availability, accuracy and prices", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ config: { provider: "jev", model: "jev-1.13.0", mode: "active", keyConfigured: true, breaker: "closed", timeoutMs: 400, fallbackPolicy: "governed System-2" }, summary: { lastSuccessAt: null, s1: { p50: null, p95: null, inputTokens: 0, costUsd: 0 }, system2DispatchRate: null, fallbackRate: null, netSavingsUsd: null, unpricedDecisions: 0, system2CallsAvoided: 0, shadowToolAgreement: { rate: null, comparable: 0 } }, recent: [] }) }));
    render(<SystemOnePanel />);
    expect(await screen.findByText(/None recorded; availability unverified/)).toBeInTheDocument();
    expect(screen.getByText("Unpriced")).toBeInTheDocument();
    expect(screen.getByText(/routing accuracy requires labeled evaluation/)).toBeInTheDocument();
  });
});
