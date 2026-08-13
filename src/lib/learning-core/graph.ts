import { syncToGraph, removeFromGraph } from "@/lib/knowledge/sync";

export async function syncCuriosityEventToGraph(event: {
  id: string;
  agentId: string;
  score: number;
  question: string | null;
  triggerContext: string | null;
  resolved: boolean;
}): Promise<void> {
  await syncToGraph({
    sourceType: "curiosity_event",
    sourceId: event.id,
    type: "CuriosityEvent",
    title: event.question ?? `Curiosity spike (${event.score.toFixed(2)})`,
    summary: event.triggerContext ?? undefined,
    scope: "global",
    metadata: { score: event.score, resolved: event.resolved },
    edges: [{ toSourceType: "agent", toSourceId: event.agentId, type: "generated_by" }],
  });
}

export async function removeCuriosityEventFromGraph(id: string): Promise<void> {
  await removeFromGraph("curiosity_event", id);
}

export async function syncKnowledgeGapToGraph(gap: {
  id: string;
  agentId: string;
  topic: string;
  description: string;
  occurrenceCount: number;
  confidence: number;
  priority: string;
  status: string;
}): Promise<void> {
  await syncToGraph({
    sourceType: "knowledge_gap",
    sourceId: gap.id,
    type: "KnowledgeGap",
    title: gap.topic,
    summary: gap.description,
    scope: "global",
    metadata: {
      occurrenceCount: gap.occurrenceCount,
      confidence: gap.confidence,
      priority: gap.priority,
      status: gap.status,
    },
    edges: [{ toSourceType: "agent", toSourceId: gap.agentId, type: "belongs_to" }],
  });
}

export async function removeKnowledgeGapFromGraph(id: string): Promise<void> {
  await removeFromGraph("knowledge_gap", id);
}

export async function syncReflectionToGraph(reflection: {
  id: string;
  agentId: string;
  taskRef: string | null;
  wentWell: string | null;
  wentWrong: string | null;
  shouldRemember: string | null;
}): Promise<void> {
  await syncToGraph({
    sourceType: "reflection",
    sourceId: reflection.id,
    type: "Reflection",
    title: reflection.taskRef ? `Reflection: ${reflection.taskRef}` : "Reflection",
    summary: reflection.shouldRemember ?? reflection.wentWrong ?? reflection.wentWell ?? undefined,
    scope: "global",
    metadata: {
      wentWell: reflection.wentWell,
      wentWrong: reflection.wentWrong,
    },
    edges: [{ toSourceType: "agent", toSourceId: reflection.agentId, type: "generated_by" }],
  });
}

export async function syncHypothesisToGraph(hypothesis: {
  id: string;
  title: string;
  problem: string;
  risk: string;
  affectedSystems: string[];
  status: string;
  approvalLevel: number;
}): Promise<void> {
  await syncToGraph({
    sourceType: "hypothesis",
    sourceId: hypothesis.id,
    type: "Hypothesis",
    title: hypothesis.title,
    summary: hypothesis.problem,
    scope: "global",
    metadata: {
      risk: hypothesis.risk,
      affectedSystems: hypothesis.affectedSystems,
      status: hypothesis.status,
      approvalLevel: hypothesis.approvalLevel,
    },
  });
}

export async function removeHypothesisFromGraph(id: string): Promise<void> {
  await removeFromGraph("hypothesis", id);
}

export async function syncExperimentToGraph(experiment: {
  id: string;
  hypothesisId: string | null;
  type: string;
  version: string;
  ownerId: string | null;
  status: string;
  approvalLevel: number;
}): Promise<void> {
  await syncToGraph({
    sourceType: "experiment",
    sourceId: experiment.id,
    type: "Experiment",
    title: `${experiment.type} experiment v${experiment.version}`,
    summary: `Status: ${experiment.status}`,
    scope: "global",
    metadata: {
      status: experiment.status,
      version: experiment.version,
      approvalLevel: experiment.approvalLevel,
    },
    edges: [
      ...(experiment.hypothesisId
        ? [{ toSourceType: "hypothesis", toSourceId: experiment.hypothesisId, type: "validates" as const }]
        : []),
      ...(experiment.ownerId
        ? [{ toSourceType: "agent", toSourceId: experiment.ownerId, type: "generated_by" as const }]
        : []),
    ],
  });
}

export async function removeExperimentFromGraph(id: string): Promise<void> {
  await removeFromGraph("experiment", id);
}

export async function syncBenchmarkToGraph(benchmark: {
  id: string;
  name: string;
  metric: string;
  value: number;
  baselineValue: number | null;
  experimentId: string | null;
}): Promise<void> {
  await syncToGraph({
    sourceType: "benchmark",
    sourceId: benchmark.id,
    type: "Benchmark",
    title: benchmark.name,
    summary: `${benchmark.metric}: ${benchmark.value}`,
    scope: "global",
    metadata: { metric: benchmark.metric, value: benchmark.value, baselineValue: benchmark.baselineValue },
    edges: benchmark.experimentId
      ? [{ toSourceType: "experiment", toSourceId: benchmark.experimentId, type: "produces" }]
      : [],
  });
}

export async function removeBenchmarkFromGraph(id: string): Promise<void> {
  await removeFromGraph("benchmark", id);
}

export async function syncTrustEventToGraph(event: {
  id: string;
  agentId: string;
  delta: number;
  reason: string;
  category: string;
}): Promise<void> {
  await syncToGraph({
    sourceType: "trust_event",
    sourceId: event.id,
    type: "TrustEvent",
    title: `${event.category.replaceAll("_", " ")} ${event.delta >= 0 ? "+" : ""}${event.delta}`,
    summary: event.reason,
    scope: "global",
    metadata: { delta: event.delta, category: event.category },
    edges: [{ toSourceType: "agent", toSourceId: event.agentId, type: "belongs_to" }],
  });
}

export async function syncSkillToGraph(skill: {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  ownerId: string | null;
  version: string;
  approvalLevel: number;
  status: string;
}): Promise<void> {
  await syncToGraph({
    sourceType: "skill",
    sourceId: skill.id,
    type: "Skill",
    title: `${skill.name} v${skill.version}`,
    summary: skill.description,
    scope: "global",
    metadata: {
      dependencies: skill.dependencies,
      approvalLevel: skill.approvalLevel,
      status: skill.status,
    },
    edges: skill.ownerId
      ? [{ toSourceType: "agent", toSourceId: skill.ownerId, type: "created_by" }]
      : [],
  });
}

export async function removeSkillFromGraph(id: string): Promise<void> {
  await removeFromGraph("skill", id);
}

export async function syncEvolutionEventToGraph(event: {
  id: string;
  title: string;
  stage: string;
  relatedType: string | null;
  relatedId: string | null;
}): Promise<void> {
  const relatedSourceType = event.relatedType?.toLowerCase().replaceAll("_", "-").replaceAll("-", "_");
  await syncToGraph({
    sourceType: "evolution_event",
    sourceId: event.id,
    // Evolution entries are durable lessons about how the system changed.
    type: "Lesson",
    title: event.title,
    summary: `Lifecycle stage: ${event.stage}`,
    scope: "global",
    metadata: { stage: event.stage, relatedType: event.relatedType, relatedId: event.relatedId },
    edges:
      relatedSourceType && event.relatedId
        ? [{ toSourceType: relatedSourceType, toSourceId: event.relatedId, type: "related_to" }]
        : [],
  });
}

export async function syncFeatureFlagToGraph(flag: {
  id: string;
  key: string;
  enabled: boolean;
  scope: string;
  scopeId: string | null;
  rolloutPercentage: number;
}): Promise<void> {
  await syncToGraph({
    sourceType: "feature_flag",
    sourceId: flag.id,
    // Feature flags are runtime module configuration, not learned evidence.
    type: "Module",
    title: flag.key,
    summary: `${flag.enabled ? "Enabled" : "Disabled"} at ${flag.rolloutPercentage}%`,
    scope: "global",
    metadata: {
      enabled: flag.enabled,
      scope: flag.scope,
      scopeId: flag.scopeId,
      rolloutPercentage: flag.rolloutPercentage,
    },
  });
}

export async function removeFeatureFlagFromGraph(id: string): Promise<void> {
  await removeFromGraph("feature_flag", id);
}
