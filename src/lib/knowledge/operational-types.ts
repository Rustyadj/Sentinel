import { z } from "zod";

export const OPERATIONAL_TYPES = ["Service", "Incident", "Alert", "Team", "Agent", "Person", "Action", "Resolution", "Deployment", "InfrastructureResource", "Failure", "Repository"] as const;
export const OPERATIONAL_RELATIONS = ["SERVICE_AFFECTED_BY_INCIDENT", "INCIDENT_TRIGGERED_ALERT", "RESPONDER_HANDLED_INCIDENT", "ACTION_RESOLVED_INCIDENT", "TEAM_OWNS_SERVICE", "depends_on", "INCIDENT_SIMILAR_TO_INCIDENT", "SERVICE_CORRELATED_WITH_SERVICE", "references"] as const;
const identity = z.string().trim().min(1).max(200);
const instant = z.string().datetime({ offset: true });
const evidence = z.array(z.string().url().max(2000).refine(value => /^https?:\/\//i.test(value), "HTTP evidence links required")).min(1).max(30);
export const operationalEventSchema = z.object({
  source: identity,
  sourceEventId: identity,
  eventTime: instant,
  entities: z.array(z.object({
    sourceId: identity,
    /** Optional existing canonical node; ingestion verifies its workspace and type before reuse. */
    objectId: identity.optional(),
    type: z.enum(OPERATIONAL_TYPES),
    title: z.string().trim().min(1).max(300),
    summary: z.string().max(6000).optional(),
    facts: z.object({
      severity: z.enum(["critical", "high", "medium", "low"]).optional(),
      status: z.enum(["open", "resolved", "healthy", "failed", "unknown"]).optional(),
      startedAt: instant.optional(),
      resolvedAt: instant.optional(),
      rootCause: z.string().max(2000).optional(),
      rootCauseConfirmed: z.boolean().optional(),
      outcome: z.enum(["successful", "unsuccessful", "unknown"]).optional(),
      classification: z.enum(["actionable", "false_positive", "duplicate", "unknown"]).optional(),
      capacityHours: z.number().positive().max(100000).optional(),
      capacityFrom: instant.optional(),
      capacityTo: instant.optional(),
      critical: z.boolean().optional(),
    }).default({}),
  })).min(1).max(100),
  relationships: z.array(z.object({
    from: identity,
    to: identity,
    type: z.enum(OPERATIONAL_RELATIONS),
    confidence: z.number().min(0).max(1),
    evidence,
    validFrom: instant,
    validTo: instant.nullable().optional(),
  })).max(200),
  evidence,
}).superRefine((event, ctx) => {
  const ids = new Set(event.entities.map(entity => entity.sourceId));
  if (ids.size !== event.entities.length) ctx.addIssue({ code: "custom", message: "Duplicate entity sourceId" });
  for (const entity of event.entities) {
    if (entity.facts.rootCauseConfirmed && !entity.facts.rootCause?.trim()) ctx.addIssue({ code: "custom", message: "Confirmed root cause requires a statement" });
    if (entity.facts.resolvedAt && (!entity.facts.startedAt || Date.parse(entity.facts.resolvedAt) < Date.parse(entity.facts.startedAt))) ctx.addIssue({ code: "custom", message: "Invalid incident interval" });
    if (entity.facts.capacityHours && (!entity.facts.capacityFrom || !entity.facts.capacityTo || Date.parse(entity.facts.capacityFrom) >= Date.parse(entity.facts.capacityTo))) ctx.addIssue({ code: "custom", message: "Capacity requires a valid reporting interval" });
  }
  const types = new Map(event.entities.map(entity => [entity.sourceId, entity.type]));
  const expected: Record<string, [readonly string[], readonly string[]]> = {
    SERVICE_AFFECTED_BY_INCIDENT: [["Service"], ["Incident"]], INCIDENT_TRIGGERED_ALERT: [["Incident"], ["Alert"]],
    RESPONDER_HANDLED_INCIDENT: [["Agent", "Person"], ["Incident"]], ACTION_RESOLVED_INCIDENT: [["Action", "Resolution"], ["Incident"]],
    TEAM_OWNS_SERVICE: [["Team"], ["Service"]], depends_on: [["Service"], ["Service"]],
    INCIDENT_SIMILAR_TO_INCIDENT: [["Incident"], ["Incident"]], SERVICE_CORRELATED_WITH_SERVICE: [["Service"], ["Service"]],
  };
  for (const edge of event.relationships) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) ctx.addIssue({ code: "custom", message: "Relationship endpoint not supplied" });
    const pair = expected[edge.type];
    if (pair && (!pair[0].includes(types.get(edge.from) ?? "") || !pair[1].includes(types.get(edge.to) ?? ""))) ctx.addIssue({ code: "custom", message: "Invalid relationship endpoint types" });
    if (edge.validTo && Date.parse(edge.validTo) <= Date.parse(edge.validFrom)) ctx.addIssue({ code: "custom", message: "Invalid relationship interval" });
  }
});
export type OperationalEvent = z.infer<typeof operationalEventSchema>;
export type OperationalFacts = OperationalEvent["entities"][number]["facts"];
export interface OperationalMetadata {
  operational: true;
  source: string;
  sourceId: string;
  sourceEventId: string;
  eventTime: string;
  evidence: string[];
  facts: OperationalFacts;
  memoryId: string | null;
}
export const OPERATIONAL_LENSES = ["incident", "dependency", "blast-radius", "team", "alert", "onboarding"] as const;
export type OperationalLens = typeof OPERATIONAL_LENSES[number];
export function operationalMetadata(value: unknown): OperationalMetadata | null {
  if (!value || typeof value !== "object" || !("operational" in value) || !value.operational) return null;
  return value as OperationalMetadata;
}
