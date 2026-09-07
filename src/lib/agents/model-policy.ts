/** Canonical model policy. Persisted operator configuration wins over deployment defaults. */
import type { AgentRuntimeKind } from "./runtime/types";

export type ManagedWorkerKind = "claude-code" | "codex";
export type EffortLevel = "none" | "low" | "medium" | "high" | "xhigh" | "max";
export interface WorkerModelConfig {
  displayName: string;
  runtimeModelId: string;
  effort: EffortLevel | null;
}
export interface EffectiveAgentModel extends WorkerModelConfig {
  source: "session" | "agent" | "environment" | "builtin";
}
export const MODEL_CHOICES: Record<AgentRuntimeKind, readonly string[]> = {
  hermes: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"],
  "claude-code": ["claude-sonnet-5", "claude-opus-5"],
  codex: ["gpt-5.6-sol", "gpt-6-astra"],
  // Verified against the installed Gemini CLI 0.58.0 on this VPS by executing each id.
  // status:"success": gemini-3.8-flash, gemini-3.5-flash, gemini-3.1-flash-lite,
  // gemini-3-flash, and "auto" (the CLI's own router).
  // status:"error" ("not found for API version v1beta") on this API key, so deliberately
  // absent: every *-pro variant, and gemini-3.8-flash-lite. An unavailable model must
  // surface as MODEL_UNAVAILABLE, never sit in a menu the runtime cannot honor.
  //
  // IMPORTANT (verified 2026-09-07): the provider currently SUBSTITUTES on this key —
  // requesting gemini-3.8-flash, gemini-3-flash or "auto" all report
  // stats.models = {"gemini-3.5-flash"}. The request is accepted, not rejected, so this
  // is not a MODEL_UNAVAILABLE condition and Sentinel cannot prevent it. It is exactly
  // why the adapter reports actualModel from the result frame: the UI must show that
  // requested and actual differ rather than implying the request was honored.
  gemini: ["gemini-3.8-flash", "gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-3-flash", "auto"],
  openclaw: [], // populated from the Gateway, never invented
};
export function isManagedWorkerKind(kind: string): kind is ManagedWorkerKind {
  return kind === "claude-code" || kind === "codex";
}
export function sentinelModelDefault(kind: AgentRuntimeKind): WorkerModelConfig {
  const model = kind === "claude-code" ? "claude-opus-5" : kind === "codex" ? "gpt-6-astra"
    : kind === "hermes" ? "gpt-5.6-luna"
    // Operator-selected default. Verified available on this API key; the Gemini CLI has
    // no reasoning-effort control, so effort stays null for this kind.
    : kind === "gemini" ? "gemini-3.8-flash"
    : process.env.OPENCLAW_MODEL ?? "claude-opus-4-8";
  return { displayName: model, runtimeModelId: model, effort: isManagedWorkerKind(kind) ? "low" : null };
}
export function validateModelConfiguration(kind: AgentRuntimeKind, model: unknown, effort: unknown): void {
  if (typeof model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) {
    throw new Error("INVALID_MODEL: use a provider model ID (1–128 characters)");
  }
  if (effort !== null && effort !== undefined && (typeof effort !== "string" || !["none", "low", "medium", "high", "xhigh", "max"].includes(effort))) {
    throw new Error("INVALID_EFFORT");
  }
  // Gemini CLI 0.58.0 exposes no reasoning-effort control (verified: no such flag in
  // `gemini --help`). Accepting one would let the UI offer a setting the runtime cannot
  // honor, so it is rejected rather than silently dropped.
  if (kind === "gemini" && effort != null && effort !== "none") {
    throw new Error("INVALID_EFFORT: the Gemini runtime does not support reasoning effort");
  }
  if (isManagedWorkerKind(kind) && effort != null && !["low", "medium", "high", "xhigh", "max"].includes(String(effort))) {
    throw new Error("INVALID_EFFORT: this runtime does not support this level");
  }
}
function deploymentDefault(agentId: string, kind: AgentRuntimeKind): EffectiveAgentModel {
  const defaults = sentinelModelDefault(kind);
  const prefix = kind === "claude-code" ? "SENTINEL_CLAUDE_DEFAULT" : kind === "codex" ? "SENTINEL_CODEX_DEFAULT"
    : kind === "hermes" ? agentId.replaceAll("-", "_").toUpperCase() : "OPENCLAW";
  const model = process.env[`${prefix}_MODEL`];
  const effort = process.env[`${prefix}_EFFORT`];
  const result = { displayName: model ?? defaults.displayName, runtimeModelId: model ?? defaults.runtimeModelId,
    effort: effort ? effort as EffortLevel : defaults.effort, source: model || effort ? "environment" as const : "builtin" as const };
  validateModelConfiguration(kind, result.runtimeModelId, result.effort);
  return result;
}
/** Compatibility for synchronous registry labels only. Execution uses the async resolver below. */
export function resolveWorkerModel(kind: ManagedWorkerKind): WorkerModelConfig { return deploymentDefault(kind, kind); }

export async function resolveEffectiveAgentModel(agentId: string, kind: AgentRuntimeKind,
  override?: { model: string; effort?: EffortLevel | null; authorized: boolean }): Promise<EffectiveAgentModel> {
  if (override) {
    if (!override.authorized) throw new Error("UNAUTHORIZED_MODEL_OVERRIDE");
    const effort = override.effort === undefined ? (await resolveEffectiveAgentModel(agentId, kind)).effort : override.effort;
    validateModelConfiguration(kind, override.model, effort);
    return { displayName: override.model, runtimeModelId: override.model, effort, source: "session" };
  }
  const { db } = await import("@/lib/db");
  // A DB outage is an error, never permission to silently use a different model.
  const agent = await db.agent.findUnique({ where: { id: agentId }, select: { model: true, reasoningEffort: true } });
  if (agent?.model) {
    validateModelConfiguration(kind, agent.model, agent.reasoningEffort);
    return { displayName: agent.model, runtimeModelId: agent.model, effort: agent.reasoningEffort as EffortLevel | null, source: "agent" };
  }
  return deploymentDefault(agentId, kind);
}
export function modelProvenance(agentId: string, kind: AgentRuntimeKind, config: EffectiveAgentModel): Record<string, unknown> {
  return { agentId, runtimeKind: kind, provider: kind === "claude-code" ? "anthropic" : kind === "codex" ? "openai" : null,
    requestedModel: config.runtimeModelId, requestedEffort: config.effort, modelConfigSource: config.source,
    configSource: config.source, startedAt: new Date().toISOString() };
}
/** Existing sessions are immutable snapshots, including recovery and resume. */
export function sessionModelConfiguration(metadata: Record<string, unknown>): EffectiveAgentModel | null {
  const legacy = metadata.requestedModel as Partial<WorkerModelConfig> | undefined;
  const model = typeof metadata.requestedModel === "string" ? metadata.requestedModel : legacy?.runtimeModelId;
  if (!model) return null;
  return { runtimeModelId: model, displayName: model,
    effort: (metadata.requestedEffort ?? legacy?.effort ?? null) as EffortLevel | null,
    source: (metadata.modelConfigSource ?? "session") as EffectiveAgentModel["source"] };
}
export function looksLikeModelUnavailable(text: string): boolean {
  return /(?:model|effort)[^\n]{0,160}(?:not found|not supported|unsupported|unavailable|unknown|invalid|does not exist|not available|access|requires a newer version)|(?:unsupported|unknown|invalid)[^\n]{0,80}(?:model|effort)/i.test(text);
}
export class ModelUnavailableError extends Error {
  readonly code = "MODEL_UNAVAILABLE";
  readonly runtime: AgentRuntimeKind;
  constructor(public readonly kind: AgentRuntimeKind, public readonly requestedModel: string,
    public readonly requestedEffort: EffortLevel | null, public readonly reason: string) {
    super(`MODEL_UNAVAILABLE: ${kind} rejected "${requestedModel}" (effort: ${requestedEffort ?? "default"}) — ${reason.slice(0, 500)}`);
    this.name = "ModelUnavailableError";
    this.runtime = kind;
  }
  toJSON() { return { code: this.code, runtime: this.runtime, requestedModel: this.requestedModel, requestedEffort: this.requestedEffort, reason: this.reason }; }
}

/** Catalog evidence comes from the installed CLI, never a universal effort list. */
export async function installedEffortOptions(runtime: { kind: AgentRuntimeKind; executable?: string }, model: string): Promise<EffortLevel[]> {
  if (!runtime.executable || !isManagedWorkerKind(runtime.kind)) return [];
  if (runtime.kind === "claude-code") {
    const { nodeRuntimeProcessRunner } = await import("./runtime/runner");
    const help = await nodeRuntimeProcessRunner.run(runtime.executable, ["--help"], { timeoutMs: 5000 }).catch(() => null);
    const line = help?.stdout.split("\n").find(line => line.includes("--effort"));
    return (["low", "medium", "high"] as EffortLevel[]).filter(level => line && new RegExp(`\\b${level}\\b`).test(line));
  }
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  try {
    const cache = JSON.parse(await readFile(join(process.env.CODEX_HOME ?? join(process.env.HOME ?? "/nonexistent", ".codex"), "models_cache.json"), "utf8"));
    const entry = cache.models?.find((value: { slug?: string }) => value.slug === model);
    const supported = entry?.supported_reasoning_levels?.map((value: { effort: string }) => value.effort) ?? [];
    return (["low", "medium", "high", "xhigh", "max"] as EffortLevel[]).filter(level => supported.includes(level));
  } catch { return []; }
}
