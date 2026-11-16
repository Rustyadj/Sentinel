import type { OperationalEvent } from "@/lib/knowledge/operational-types";
/** Labeled synthetic incidents only. No runtime or production seed imports these fixtures. */
export function syntheticIncident(index: number, service = "Sentinel gateway", at = new Date(Date.UTC(2026, 8, index + 1))): OperationalEvent {
  const eventTime = at.toISOString();
  const incident = `synthetic-incident-${index}`;
  const evidence = [`https://synthetic.example.test/incidents/${index}`];
  return { source: "synthetic-test", sourceEventId: `synthetic-event-${index}`, eventTime, evidence,
    entities: [
      { sourceId: "gateway", type: "Service", title: service, facts: { status: "unknown" } },
      { sourceId: incident, type: "Incident", title: `SYNTHETIC ${service} outage ${index}`, summary: `SYNTHETIC incident: connection pool exhausted during deployment ${index}`, facts: { severity: "high", status: "resolved", startedAt: eventTime, resolvedAt: new Date(at.getTime() + 20 * 60_000).toISOString(), rootCause: "Pool limit", rootCauseConfirmed: index !== 2 } },
      { sourceId: "responder", type: "Person", title: "Synthetic responder", facts: {} },
      { sourceId: `action-${index}`, type: "Action", title: "Expanded pool", summary: "The fix increased the connection limit", facts: { outcome: "successful" } },
      { sourceId: `failed-action-${index}`, type: "Action", title: "Restart attempt", facts: { outcome: "unsuccessful" } },
    ],
    relationships: [
      { from: "gateway", to: incident, type: "SERVICE_AFFECTED_BY_INCIDENT", confidence: 0.95, evidence, validFrom: eventTime },
      { from: "responder", to: incident, type: "RESPONDER_HANDLED_INCIDENT", confidence: 1, evidence, validFrom: eventTime },
      { from: `action-${index}`, to: incident, type: "ACTION_RESOLVED_INCIDENT", confidence: 0.9, evidence, validFrom: eventTime },
      { from: `failed-action-${index}`, to: incident, type: "references", confidence: 1, evidence, validFrom: eventTime },
    ],
  };
}
