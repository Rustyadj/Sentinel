/**
 * Operational autonomy configuration: one typed key set, resolved
 * agent row -> workspace row -> built-in default. Pure (no Prisma) so the
 * admin UI and tests share it; persistence lives in settings-store.ts.
 *
 * Productive autonomy is the default. Nothing here can override provider
 * requirements, tenant isolation, infrastructure access control, or the
 * authority checks in authority.ts — there is deliberately no "allow
 * everything" key. These settings shape *how much* agents do on their own
 * within the authority they already hold.
 */

export interface AutonomySettingsValues {
  /** Agents may start work nobody asked for when it serves an assigned objective. */
  proactiveExecution: boolean;
  /** Agents may create their own subtasks inside an authorized objective. */
  independentTaskGeneration: boolean;
  /** Continue to the next step automatically instead of waiting for a new user message. */
  automaticContinuation: boolean;
  /** Agents may hand subtasks to other qualified agents (still inside the originating authority). */
  autonomousDelegation: boolean;
  /** Agents may look up and use any authorized capability, not only a static tool list. */
  dynamicToolDiscovery: boolean;
  /** Agents may create, test and version reusable skills in sandboxed/authorized scope. */
  skillDevelopment: boolean;
  /** Recurring/scheduled workflows may run. */
  recurringWorkflows: boolean;
  /** Standing delegation grants are honoured (off = every gated action asks a human). */
  standingDelegation: boolean;
  /** External integrations may be invoked when a grant covers them. */
  externalIntegrations: boolean;
  /** Reasoning/orchestration turns an objective may take before it pauses for review. Execution budget, not a hard universal cap. */
  maxOrchestrationIterations: number;
  /** Tool/step failures an objective may absorb (retrying, switching strategy) before escalating. */
  maxRecoveryAttempts: number;
  /** Concurrent tasks per agent. */
  maxConcurrentTasks: number;
  /** Minimum minutes between proactive activations for one agent (anti-spam). */
  proactiveIntervalMinutes: number;
  /** Proactive work items an agent may start per day. */
  proactiveDailyLimit: number;
  /** Minimum priority score (0..1) proactive work must reach before it runs. */
  proactiveMinScore: number;
}

export const DEFAULT_AUTONOMY_SETTINGS: AutonomySettingsValues = {
  proactiveExecution: true,
  independentTaskGeneration: true,
  automaticContinuation: true,
  autonomousDelegation: true,
  dynamicToolDiscovery: true,
  skillDevelopment: true,
  recurringWorkflows: true,
  standingDelegation: true,
  externalIntegrations: true,
  maxOrchestrationIterations: 60,
  maxRecoveryAttempts: 4,
  maxConcurrentTasks: 4,
  proactiveIntervalMinutes: 30,
  proactiveDailyLimit: 12,
  proactiveMinScore: 0.55,
};

type NumericKey = { [K in keyof AutonomySettingsValues]: AutonomySettingsValues[K] extends number ? K : never }[keyof AutonomySettingsValues];

/** Sanity bounds — these protect infrastructure, not policy preferences. */
export const NUMERIC_BOUNDS: Record<NumericKey, { min: number; max: number; integer: boolean }> = {
  maxOrchestrationIterations: { min: 1, max: 500, integer: true },
  maxRecoveryAttempts: { min: 0, max: 20, integer: true },
  maxConcurrentTasks: { min: 1, max: 32, integer: true },
  proactiveIntervalMinutes: { min: 1, max: 10_080, integer: true },
  proactiveDailyLimit: { min: 0, max: 500, integer: true },
  proactiveMinScore: { min: 0, max: 1, integer: false },
};

export const AUTONOMY_SETTING_KEYS = Object.keys(DEFAULT_AUTONOMY_SETTINGS) as (keyof AutonomySettingsValues)[];

/** Allowlist-parse a partial settings object (API boundary / stored JSON). Unknown keys and bad values are dropped. */
export function sanitizeAutonomySettings(input: unknown): Partial<AutonomySettingsValues> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const record = input as Record<string, unknown>;
  const out: Partial<Record<keyof AutonomySettingsValues, boolean | number>> = {};
  for (const key of AUTONOMY_SETTING_KEYS) {
    const value = record[key];
    const fallback = DEFAULT_AUTONOMY_SETTINGS[key];
    if (typeof fallback === "boolean") {
      if (typeof value === "boolean") out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      const bounds = NUMERIC_BOUNDS[key as NumericKey];
      const clamped = Math.min(bounds.max, Math.max(bounds.min, value));
      out[key] = bounds.integer ? Math.round(clamped) : clamped;
    }
  }
  return out as Partial<AutonomySettingsValues>;
}

/** Agent overrides workspace overrides defaults, key by key. */
export function resolveAutonomySettings(workspace: unknown, agent?: unknown): AutonomySettingsValues {
  return { ...DEFAULT_AUTONOMY_SETTINGS, ...sanitizeAutonomySettings(workspace), ...sanitizeAutonomySettings(agent) };
}
