import type { SystemOneMode, SystemOneSurface } from "./types";

type Env = Readonly<Record<string, string | undefined>>;

export interface ConfidenceBand {
  /** At or above: act on the decision. */
  high: number;
  /** Below: ignore the decision entirely and take today's path. */
  low: number;
}

export interface SystemOneConfig {
  /** Global mode; resolve a specific agent's with {@link resolveAgentMode}. */
  mode: SystemOneMode;
  provider: "jev";
  apiKey: string | null;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  voiceTimeoutMs: number;
  thresholds: {
    route: ConfidenceBand;
    tool: ConfidenceBand;
    /** A yes/no probability counts as a firm "yes" at or above this, a firm "no" at or below 1 - this. */
    noul: number;
  };
  fastPathSurfaces: ReadonlySet<SystemOneSurface>;
  breaker: { failureThreshold: number; openMs: number };
  warmup: boolean;
}

const MODES: ReadonlySet<string> = new Set(["off", "shadow", "active"]);
const SURFACES: ReadonlySet<string> = new Set(["chat", "runtime_chat", "voice"]);

function num(env: Env, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function band(env: Env, decision: string, high: number, low: number): ConfidenceBand {
  const h = num(env, `SYSTEM_ONE_${decision}_HIGH_CONFIDENCE`, high, 0, 1);
  const l = num(env, `SYSTEM_ONE_${decision}_LOW_CONFIDENCE`, low, 0, 1);
  // An inverted band would let a "low" decision act; clamp rather than trust it.
  return { high: h, low: Math.min(l, h) };
}

function parseMode(raw: string | undefined): SystemOneMode | null {
  const value = raw?.trim().toLowerCase();
  return value && MODES.has(value) ? (value as SystemOneMode) : null;
}

export function agentEnvSlug(agentId: string): string {
  return agentId.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
}

export function resolveSystemOneConfig(env: Env = process.env): SystemOneConfig {
  // SYSTEM_ONE_ENABLED=false is the hard kill switch: it wins over any mode.
  const killed = env.SYSTEM_ONE_ENABLED?.trim().toLowerCase() === "false";
  const mode = killed ? "off" : parseMode(env.SYSTEM_ONE_MODE) ?? "off";
  const highDefault = num(env, "SYSTEM_ONE_HIGH_CONFIDENCE", 0.85, 0, 1);
  const lowDefault = num(env, "SYSTEM_ONE_LOW_CONFIDENCE", 0.5, 0, 1);
  const surfaces = (env.SYSTEM_ONE_FAST_PATH_SURFACES ?? "voice")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is SystemOneSurface => SURFACES.has(s));

  return {
    mode,
    provider: "jev",
    apiKey: env.SYSTEM_ONE_API_KEY?.trim() || env.OPENROUTER_API_KEY?.trim() || null,
    baseUrl: (env.SYSTEM_ONE_BASE_URL?.trim() || "https://openrouter.ai/api").replace(/\/+$/, ""),
    // Pinned, not jev-latest: thresholds are tuned against one model version.
    model: env.SYSTEM_ONE_MODEL?.trim() || "jev-1.13",
    timeoutMs: num(env, "SYSTEM_ONE_TIMEOUT_MS", 400, 50, 5_000),
    voiceTimeoutMs: num(env, "SYSTEM_ONE_VOICE_TIMEOUT_MS", 250, 50, 5_000),
    thresholds: {
      route: band(env, "ROUTE", highDefault, lowDefault),
      tool: band(env, "TOOL", highDefault, lowDefault),
      noul: num(env, "SYSTEM_ONE_NOUL_THRESHOLD", 0.9, 0.5, 1),
    },
    fastPathSurfaces: new Set(surfaces),
    breaker: {
      failureThreshold: num(env, "SYSTEM_ONE_BREAKER_FAILURES", 5, 1, 1_000),
      openMs: num(env, "SYSTEM_ONE_BREAKER_OPEN_MS", 30_000, 1_000, 3_600_000),
    },
    warmup: env.SYSTEM_ONE_WARMUP?.trim().toLowerCase() !== "false",
  };
}

/**
 * Mode for one agent. A per-agent override (`SYSTEM_ONE_MODE_HERMES_NATHAN2`)
 * lets one agent go active while another stays in shadow — but it can never
 * turn the layer on when the global kill switch is off.
 */
export function resolveAgentMode(agentId: string, env: Env = process.env): SystemOneMode {
  if (env.SYSTEM_ONE_ENABLED?.trim().toLowerCase() === "false") return "off";
  return parseMode(env[`SYSTEM_ONE_MODE_${agentEnvSlug(agentId)}`]) ?? resolveSystemOneConfig(env).mode;
}

export function surfaceTimeoutMs(config: SystemOneConfig, surface: SystemOneSurface): number {
  return surface === "voice" ? config.voiceTimeoutMs : config.timeoutMs;
}
