import { db } from "@/lib/db";
import { emitLearningEvent } from "@/lib/learning/event-service";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { installedEffortOptions, MODEL_CHOICES, resolveEffectiveAgentModel, sentinelModelDefault, validateModelConfiguration } from "./model-policy";
import { getRuntimeView } from "./runtime/service";

export async function saveAgentModel(agentId: string, user: { id: string; workspaceId: string }, input: { model?: unknown; reasoningEffort?: unknown; reset?: boolean }) {
  const runtime = await getRuntimeView(agentId);
  if (!runtime) throw new Error("Runtime not found");
  const existing = await db.agent.findUniqueOrThrow({ where: { id: agentId } });
  const defaults = sentinelModelDefault(runtime.kind);
  const model = input.reset ? defaults.runtimeModelId : input.model ?? existing.model;
  const reasoningEffort = input.reset ? defaults.effort : input.reasoningEffort === undefined ? existing.reasoningEffort : input.reasoningEffort;
  validateModelConfiguration(runtime.kind, model, reasoningEffort);
  return db.$transaction(async tx => {
    const agent = await tx.agent.update({ where: { id: agentId }, data: { model: model as string, reasoningEffort: reasoningEffort as string | null } });
    const details = { runtime: runtime.kind, before: { model: existing.model, reasoningEffort: existing.reasoningEffort }, after: { model, reasoningEffort }, effect: "new_sessions" };
    await writeAuditLog({ userId: user.id, workspaceId: existing.workspaceId ?? user.workspaceId, action: "agent.model_configuration_changed", entityType: "Agent", entityId: agentId, details }, tx);
    await emitLearningEvent({ eventType: "agent_model_configuration_changed", sourceType: "agent", sourceId: agentId, agentId, userId: user.id, workspaceId: existing.workspaceId ?? user.workspaceId, payload: details }, tx);
    return agent;
  });
}

export async function getAgentModelSettings(agentId: string, userId: string) {
  const runtime = await getRuntimeView(agentId);
  if (!runtime) throw new Error("Runtime not found");
  const config = await resolveEffectiveAgentModel(agentId, runtime.kind);
  const sessions = await db.agentSession.findMany({ where: { agentId, userId }, orderBy: { startedAt: "desc" }, take: 30 });
  const choices = [...new Set([...MODEL_CHOICES[runtime.kind], config.runtimeModelId])];
  const effortOptions = Object.fromEntries(await Promise.all(choices.map(async id => [id, await installedEffortOptions(runtime, id)])));
  const options = choices.map(id => {
    const evidence = sessions.find(s => { const m = s.metadata as Record<string, unknown>; return m.requestedModel === id && (m.modelUnavailable === true || (s.status === "completed" && m.actualModel === id)); });
    const metadata = evidence?.metadata as Record<string, unknown> | undefined;
    // A request is not evidence that the provider actually used it.
    const state = metadata?.modelUnavailable ? "unavailable" : evidence?.status === "completed" && metadata?.actualModel === id ? "AVAILABLE" : id === config.runtimeModelId ? "configured" : "unverified";
    return { id, state, efforts: effortOptions[id] };
  });
  return { runtime: runtime.kind, provider: runtime.kind === "claude-code" ? "anthropic" : runtime.kind === "codex" ? "openai" : "Hermes provider (session-reported)", config, options,
    efforts: await installedEffortOptions(runtime, config.runtimeModelId),
    effect: "new_sessions", availability: options.find(o => o.id === config.runtimeModelId)?.state,
    lastSession: sessions[0] ? { id: sessions[0].id, status: sessions[0].status, metadata: sessions[0].metadata } : null };
}
