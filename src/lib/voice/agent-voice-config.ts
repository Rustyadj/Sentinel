/**
 * Declarative per-agent voice configuration.
 *
 * One record per agent, naming both halves of the split explicitly: the
 * live conversational layer that carries audio, and the reasoning model that
 * actually thinks. GPT-Live-1 is the voice interface only — it is never the
 * brain, and it never substitutes for an agent's identity. Everything
 * substantive is routed to `reasoningModel` through Sentinel's existing
 * runtime, so voice and typed chat share one conversation, one memory, one
 * permission model and one tool path.
 *
 * The shape here is deliberately the shape an `Agent` row will eventually
 * hold. Until then this registry is the single source of truth, and reading
 * config for an agent that has no entry fails rather than guessing.
 */

export interface AgentVoiceConfig {
  /** Canonical Sentinel agent id. */
  readonly agentId: string;
  /** Who serves the live audio session. */
  readonly voiceProvider: "openai";
  /** The live conversational model — audio in, audio out. Not a reasoner. */
  readonly voiceModel: string;
  /** Named voice for this agent. Fixed per agent; never inherited. */
  readonly voice: string;
  /** Who serves the reasoning model. */
  readonly reasoningProvider: "openai" | "openrouter" | "anthropic";
  /** The model that actually answers. */
  readonly reasoningModel: string;
  /** Used only when `reasoningModel` is unavailable, never for quality escalation. */
  readonly fallbackModel: string;
}

export const CANONICAL_VOICE_AGENT_IDS = ["hermes-lisa", "hermes-nathan2"] as const;
export type VoiceAgentId = (typeof CANONICAL_VOICE_AGENT_IDS)[number];

export const GPT_LIVE_VOICE_MODEL = "gpt-live-1";

/**
 * Aliases accepted from clients, each mapping to exactly one canonical id.
 *
 * Note what is absent: there is no entry for an empty or unrecognized value.
 * The previous resolver returned Lisa for `undefined`, which meant a session
 * request that simply omitted agentId was answered in Lisa's voice, with
 * Lisa's instructions, against Lisa's room — an identity swap nobody asked
 * for and nothing logged.
 */
const AGENT_ID_ALIASES: Readonly<Record<string, VoiceAgentId>> = {
  "hermes-lisa": "hermes-lisa",
  lisa: "hermes-lisa",
  "hermes-nathan2": "hermes-nathan2",
  nathan2: "hermes-nathan2",
  nathan: "hermes-nathan2",
};

const BASE_CONFIG: Readonly<Record<VoiceAgentId, AgentVoiceConfig>> = {
  "hermes-lisa": {
    agentId: "hermes-lisa",
    voiceProvider: "openai",
    voiceModel: GPT_LIVE_VOICE_MODEL,
    voice: "gleam",
    reasoningProvider: "openrouter",
    reasoningModel: "deepseek/deepseek-v4.1-flash",
    fallbackModel: "deepseek/deepseek-v4.1-flash",
  },
  "hermes-nathan2": {
    agentId: "hermes-nathan2",
    voiceProvider: "openai",
    voiceModel: GPT_LIVE_VOICE_MODEL,
    voice: "meridian",
    reasoningProvider: "openai",
    reasoningModel: "gpt-5.6-luna",
    fallbackModel: "gpt-5.6-luna",
  },
};

/**
 * Env overrides are namespaced per agent on purpose.
 *
 * A single shared OPENAI_REALTIME_VOICE variable is what made every agent
 * speak with the same voice regardless of who they were; there is
 * deliberately no global override here, so misconfiguring one agent cannot
 * silently retune the other.
 */
function envKey(agentId: VoiceAgentId, field: string): string {
  const slug = agentId.replace(/[^a-z0-9]+/gi, "_").toUpperCase();
  return `SENTINEL_VOICE_${slug}_${field}`;
}

export function resolveAgentVoiceConfig(
  agentId: string | null | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): AgentVoiceConfig | null {
  const normalized = agentId?.trim().toLowerCase();
  if (!normalized) return null;
  const canonical = AGENT_ID_ALIASES[normalized];
  if (!canonical) return null;

  const base = BASE_CONFIG[canonical];
  const override = (field: string, fallback: string) =>
    env[envKey(canonical, field)]?.trim() || fallback;

  return {
    ...base,
    voiceModel: override("VOICE_MODEL", base.voiceModel),
    voice: override("VOICE", base.voice),
    reasoningModel: override("REASONING_MODEL", base.reasoningModel),
    fallbackModel: override("FALLBACK_MODEL", base.fallbackModel),
  };
}

/**
 * Identity and speaking style for the live layer.
 *
 * This says nothing about *what* to think — it tells the live model to carry
 * the conversation and delegate every substantive turn. GPT-Live runs in
 * client delegation mode: its delegations come to Sentinel, which runs them on
 * the agent's own reasoning model, memory and tools and sends the result back.
 */
export function liveSessionInstructions(config: AgentVoiceConfig): string {
  const identity =
    config.agentId === "hermes-nathan2"
      ? "You are Hermes Nathan2, the MobileOps ICF field-operations specialist. Be warm, direct, concise and action-oriented."
      : "You are Hermes Lisa, the chief orchestrator for Sentinel OS. Be warm, concise, natural and decisive.";

  return `${identity}

You are the live voice of this agent, not its mind. You carry the spoken conversation: listen, acknowledge briefly, and speak answers naturally. Prefer short replies. Ask only one clarification at a time. Never read markdown syntax aloud.

Delegation policy:
Backend: this agent's own reasoning model, memory and tools. It is the one who actually does work and knows facts.

Delegate to the backend when:
- The user asks a question that needs facts, current information or careful reasoning.
- The user asks you to do, check, find, make, fix, run or remember anything.
- A correction changes work already requested.

Do not delegate when:
- The user greets you, makes small talk, or asks you to repeat a result you were already given.
- You need one brief clarification to understand the request.

Never answer a substantive question from your own knowledge: that would be speaking for an agent you are not. Delegate quietly. Do not say filler such as "hold on", "one moment", "give me a second" or "let me check" before or while the backend works — a short silence is better. If the work is still running after a few seconds, one brief acknowledgement is enough.

When the backend returns a lookup result, present only what it contains, briefly and naturally, and add nothing it does not say. If it does not answer the question, say so.

If the user speaks while an answer is pending or being spoken, stop and listen: their new words replace the old request.

Never claim an action was completed unless the backend result confirms it.`;
}
