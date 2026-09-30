import { MODEL_CHOICES, resolveEffectiveAgentModel, sentinelModelDefault, validateModelConfiguration } from "@/lib/agents/model-policy";
import { getRuntimeView, listRuntimeViews } from "@/lib/agents/runtime/service";
import type { AgentRuntimeKind, RuntimeView } from "@/lib/agents/runtime/types";
import type { BotModelConfig } from "./schema";

export class BotConfigError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "BotConfigError"; }
}

/** Runtimes that can host a bot: Hermes only, enabled. Verification is a separate, activation-time check. */
export async function listBotHosts(): Promise<RuntimeView[]> {
  return (await listRuntimeViews()).filter((runtime) => runtime.kind === "hermes" && runtime.enabled);
}

export async function requireBotHost(agentId: string): Promise<RuntimeView> {
  const runtime = await getRuntimeView(agentId);
  if (!runtime || runtime.kind !== "hermes" || !runtime.enabled) {
    throw new BotConfigError(`"${agentId}" is not an enabled Hermes runtime, so it cannot host a bot.`);
  }
  return runtime;
}

export interface BotModelOptions {
  runtimeAgentId: string;
  runtimeKind: AgentRuntimeKind;
  /** Model the runtime would use with no bot override. */
  inherited: { model: string; effort: string | null; source: string };
  /** Models Sentinel's registry lists for this runtime kind. */
  choices: string[];
  /** Config fields this runtime cannot honour, so the UI does not offer them. */
  unsupported: string[];
}

/** Model choices come from the model registry, never from a list in this feature. */
export async function botModelOptions(runtimeAgentId: string): Promise<BotModelOptions> {
  const runtime = await requireBotHost(runtimeAgentId);
  const inherited = await resolveEffectiveAgentModel(runtime.agentId, runtime.kind);
  const choices = [...new Set([...MODEL_CHOICES[runtime.kind], inherited.runtimeModelId, sentinelModelDefault(runtime.kind).runtimeModelId])];
  return {
    runtimeAgentId: runtime.agentId,
    runtimeKind: runtime.kind,
    inherited: { model: inherited.runtimeModelId, effort: inherited.effort, source: inherited.source },
    choices,
    // Hermes' session.create takes a model and a reasoning effort. Temperature is
    // not a documented parameter, so Sentinel does not store one it cannot apply.
    unsupported: ["temperature"],
  };
}

const MODEL_ROLES = ["primary", "fast", "reasoning", "vision", "fallback"] as const;

/** Same validation the per-agent model setting uses; throws BotConfigError. */
export function validateBotModelConfig(kind: AgentRuntimeKind, config: BotModelConfig): void {
  for (const role of MODEL_ROLES) {
    const model = config[role];
    if (model === undefined) continue;
    try { validateModelConfiguration(kind, model, config.effort ?? null); }
    catch (error) { throw new BotConfigError(`${role} model: ${error instanceof Error ? error.message : "invalid"}`); }
  }
}

/** The model a task will request for a role: the bot's choice, else the runtime's default. */
export function selectBotModel(config: BotModelConfig, role: "primary" | "fast" | "reasoning" | "vision"): string | null {
  return config[role] ?? config.primary ?? null;
}
