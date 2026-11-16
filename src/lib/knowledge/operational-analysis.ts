/** Pure, bounded operational analysis. Inputs must already be workspace/governance scoped. */
export interface FailureObservation { incidentId: string; serviceId: string; at: number; evidence: string[] }
export interface CorrelationProposal {
  from: string; to: string; support: number; trials: number; lift: number;
  confidence: number; evidence: string[]; incidentIds: string[]; sequence: boolean;
  validation: { samples: number; hits: number; precision: number | null; lowerBound: number; reliable: boolean };
}
export function wilsonLower(hits: number, count: number): number {
  if (!count) return 0;
  const z = 1.96, p = hits / count, z2 = z * z;
  return (p + z2 / (2 * count) - z * Math.sqrt(p * (1 - p) / count + z2 / (4 * count * count))) / (1 + z2 / count);
}
export function discoverCorrelations(input: FailureObservation[], windowMs = 30 * 60_000): CorrelationProposal[] {
  const observations = [...new Map(input.map(item => [`${item.serviceId}:${item.incidentId}`, item])).values()].sort((a, b) => a.at - b.at).slice(-1000);
  const services = [...new Set(observations.map(item => item.serviceId))].slice(0, 100);
  const proposals: CorrelationProposal[] = [];
  for (const from of services) for (const to of services) {
    if (from === to) continue;
    const source = observations.filter(item => item.serviceId === from);
    const target = observations.filter(item => item.serviceId === to);
    const split = Math.max(3, Math.floor(source.length * 0.7));
    const train = source.slice(0, split), test = source.slice(split);
    // Matching is one-to-one: one target outage cannot explain many source outages.
    const match = (left: FailureObservation[], right: FailureObservation[]) => {
      const used = new Set<string>();
      return left.flatMap(item => {
        const other = right.filter(candidate => !used.has(candidate.incidentId) && Math.abs(candidate.at - item.at) <= windowMs).sort((a, b) => Math.abs(a.at - item.at) - Math.abs(b.at - item.at))[0];
        if (!other) return [];
        used.add(other.incidentId);
        return [{ item, other }];
      });
    };
    const cutoff = test[0]?.at ?? Infinity;
    const trainingTarget = target.filter(item => item.at < cutoff);
    const matches = match(train, trainingTarget);
    const independentWindows = new Set(matches.map(({ item }) => Math.floor(item.at / (2 * windowMs))));
    const trainingSpan = Math.max(windowMs, (test[0]?.at ?? train.at(-1)!.at) - train[0].at);
    const baseline = Math.min(1, trainingTarget.length * 2 * windowMs / trainingSpan);
    const lift = baseline ? (matches.length / train.length) / baseline : 0;
    if (matches.length < 3 || independentWindows.size < 3 || lift < 2) continue;
    const heldout = match(test, target.filter(item => item.at >= cutoff));
    const lowerBound = wilsonLower(heldout.length, test.length);
    proposals.push({ from, to, support: matches.length, trials: train.length, lift, confidence: wilsonLower(matches.length, train.length), sequence: matches.every(({ item, other }) => other.at > item.at), incidentIds: [...new Set(matches.flatMap(({ item, other }) => [item.incidentId, other.incidentId]))], evidence: [...new Set(matches.flatMap(({ item, other }) => [...item.evidence, ...other.evidence]))].slice(0, 100), validation: { samples: test.length, hits: heldout.length, precision: test.length ? heldout.length / test.length : null, lowerBound, reliable: test.length >= 5 && lowerBound >= 0.5 } });
  }
  return proposals.slice(0, 200);
}
export interface Impact { serviceId: string; status: "confirmed" | "predicted" | "unknown"; confidence: number | null; evidence: string[]; reasons: string[] }
export function predictBlastRadius(failed: string, serviceIds: string[], dependencies: { from: string; to: string; evidence: string[] }[], correlations: CorrelationProposal[], health: Map<string, { status: string; at: number; evidence: string[] }>, now = Date.now()): Impact[] {
  const impacts = new Map<string, Impact>();
  const sourceHealth = health.get(failed);
  const currentlyFailed = sourceHealth?.status === "failed" && now - sourceHealth.at >= 0 && now - sourceHealth.at <= 5 * 60_000;
  impacts.set(failed, { serviceId: failed, status: currentlyFailed ? "confirmed" : "unknown", confidence: currentlyFailed ? 1 : null, evidence: sourceHealth?.evidence ?? [], reasons: [currentlyFailed ? "Observed current failure" : "Failure premise; current health unavailable or stale"] });
  let frontier = [failed];
  for (let hop = 0; hop < 3 && frontier.length; hop++) {
    const next: string[] = [];
    for (const dependency of dependencies) {
      // A depends_on B => failure of B can affect A.
      if (!frontier.includes(dependency.to) || impacts.has(dependency.from)) continue;
      impacts.set(dependency.from, { serviceId: dependency.from, status: "predicted", confidence: null, evidence: dependency.evidence, reasons: ["Confirmed dependency; impact conditional, probability uncalibrated"] });
      next.push(dependency.from);
    }
    frontier = next;
  }
  for (const relation of correlations) {
    if (relation.from !== failed || impacts.has(relation.to)) continue;
    impacts.set(relation.to, { serviceId: relation.to, status: relation.validation.reliable && relation.sequence ? "predicted" : "unknown", confidence: relation.validation.samples ? relation.validation.precision : null, evidence: relation.evidence, reasons: [relation.validation.reliable && relation.sequence ? "Chronological holdout supports failure sequence" : "Correlation lacks reliable directional validation"] });
  }
  for (const id of serviceIds) {
    const observation = health.get(id);
    if (observation?.status === "failed" && now - observation.at >= 0 && now - observation.at <= 5 * 60_000) impacts.set(id, { serviceId: id, status: "confirmed", confidence: 1, evidence: observation.evidence, reasons: ["Observed failure; causality not established"] });
    else if (!impacts.has(id)) impacts.set(id, { serviceId: id, status: "unknown", confidence: null, evidence: observation?.evidence ?? [], reasons: [observation?.status === "healthy" && now - observation.at <= 5 * 60_000 ? "Currently healthy; future impact unknown" : "No supported impact estimate"] });
  }
  return [...impacts.values()].slice(0, 200);
}
