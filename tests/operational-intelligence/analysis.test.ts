import { describe, expect, it } from "vitest";
import { discoverCorrelations, predictBlastRadius, wilsonLower, type FailureObservation } from "@/lib/knowledge/operational-analysis";
const history = (count = 20): FailureObservation[] => Array.from({ length: count }, (_, index) => [
  { incidentId: `SYNTHETIC-a-${index}`, serviceId: "upstream", at: index * 86400000, evidence: [`https://synthetic.test/${index}`] },
  { incidentId: `SYNTHETIC-b-${index}`, serviceId: "downstream", at: index * 86400000 + 60000, evidence: [`https://synthetic.test/${index}`] },
]).flat();
describe("operational correlation and blast radius", () => {
  it("discovers repeated directional sequences and evaluates later incidents separately", () => {
    const proposal = discoverCorrelations(history()).find(item => item.from === "upstream")!;
    expect(proposal.sequence).toBe(true);
    expect(proposal.validation).toMatchObject({ samples: 6, hits: 6, precision: 1, reliable: true });
    expect(proposal.confidence).toBeLessThan(1);
    expect(proposal.evidence.length).toBeGreaterThan(0);
  });
  it("does not count duplicate imports as independent evidence", () => { const items = history(1); expect(discoverCorrelations(Array.from({ length: 100 }, () => items).flat())).toEqual([]); });
  it("rejects a single storm and ubiquitous unrelated failures", () => {
    expect(discoverCorrelations(history().map((item, index) => ({ ...item, at: index * 1000 })))).toEqual([]);
  });
  it("does not invent certainty from a tiny sample or from reverse order", () => {
    const correlations = discoverCorrelations(history(5));
    expect(correlations.every(item => !item.validation.reliable)).toBe(true);
    const impacts = predictBlastRadius("downstream", ["upstream", "downstream"], [], discoverCorrelations(history()), new Map());
    expect(impacts.find(item => item.serviceId === "upstream")?.status).toBe("unknown");
    expect(wilsonLower(0, 0)).toBe(0);
  });
  it("traverses dependencies in the impact direction and distinguishes observations", () => {
    const impacts = predictBlastRadius("db", ["db", "api", "external"], [{ from: "api", to: "db", evidence: ["https://synthetic.test/dependency"] }], [], new Map([["db", { status: "failed", at: 1000, evidence: ["https://synthetic.test/health"] }]]), 1001);
    expect(impacts.find(item => item.serviceId === "db")?.status).toBe("confirmed");
    expect(impacts.find(item => item.serviceId === "api")).toMatchObject({ status: "predicted", confidence: null });
    expect(impacts.find(item => item.serviceId === "external")?.status).toBe("unknown");
  });
  it("ignores stale health as confirmation and bounds cyclic expansion", () => {
    const impacts = predictBlastRadius("db", ["db", "api"], [{ from: "api", to: "db", evidence: [] }, { from: "db", to: "api", evidence: [] }], [], new Map([["db", { status: "failed", at: 0, evidence: [] }]]), 3600000);
    expect(impacts).toHaveLength(2); expect(impacts[0].status).toBe("unknown");
  });
});
