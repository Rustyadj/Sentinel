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
  /** Speech-to-text model for live transcripts. */
  readonly transcriptionModel: string;
}

export const CANONICAL_VOICE_AGENT_IDS = ["hermes-lisa", "hermes-nathan2"] as const;
export type VoiceAgentId = (typeof CANONICAL_VOICE_AGENT_IDS)[number];

export const GPT_LIVE_VOICE_MODEL = "gpt-live-1";
export const GPT_LIVE_TRANSCRIPTION_MODEL = "gpt-live-transcribe";

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
    voice: "sol",
    reasoningProvider: "openrouter",
    reasoningModel: "deepseek/deepseek-v4.1-flash",
    fallbackModel: "deepseek/deepseek-v4.1-flash",
    transcriptionModel: GPT_LIVE_TRANSCRIPTION_MODEL,
  },
  "hermes-nathan2": {
    agentId: "hermes-nathan2",
    voiceProvider: "openai",
    voiceModel: GPT_LIVE_VOICE_MODEL,
    voice: "spruce",
    reasoningProvider: "openai",
    reasoningModel: "gpt-5.6-luna",
    fallbackModel: "gpt-5.6-luna",
    transcriptionModel: GPT_LIVE_TRANSCRIPTION_MODEL,
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
    transcriptionModel: override("TRANSCRIPTION_MODEL", base.transcriptionModel),
  };
}

/**
 * Identity and speaking style for the live layer.
 *
 * This says nothing about *what* to think — it tells the live model to carry
 * the conversation and hand every substantive turn to Sentinel, because the
 * agent's real reasoning, memory and tools live there.
 */
export function liveSessionInstructions(config: AgentVoiceConfig): string {
  const identity =
    config.agentId === "hermes-nathan2"
      ? "You are Hermes Nathan2, the MobileOps ICF field-operations specialist. Be warm, direct, concise and action-oriented."
      : "You are Hermes Lisa, the chief orchestrator for Sentinel OS. Be warm, concise, natural and decisive.";

  return `${identity}

You are the live voice of this agent, not its mind. You carry the spoken conversation: listen, acknowledge briefly, and speak answers naturally. Prefer short replies. Ask only one clarification at a time. Never read markdown syntax aloud.

You do not answer substantive questions yourself. For anything beyond a greeting, an acknowledgement, or a clarifying question, call ${SENTINEL_REASONING_TOOL} with the user's request and speak the answer it returns. That call reaches this agent's own reasoning model, memory, and tools — it is the only path to them, and answering from your own knowledge instead would be speaking for an agent you are not.

Never claim an action was completed unless a tool result proves it.`;
}

export const SENTINEL_REASONING_TOOL = "sentinel_reasoning";

/**
 * The single tool the live layer is given.
 *
 * It is not an "escalation" — there is no cheap path that answers first and a
 * better one behind a judgement call. Reasoning always leaves the live model,
 * because that is the only way voice and typed chat stay the same agent.
 */
export const SENTINEL_REASONING_TOOL_DEFINITION = {
  type: "function",
  name: SENTINEL_REASONING_TOOL,
  description:
    "Send the user's request to this agent's own reasoning model, memory and tools in Sentinel, and receive the answer to speak. Required for every substantive turn.",
  parameters: {
    type: "object",
    properties: {
      request: {
        type: "string",
        description: "The user's request, verbatim where possible.",
      },
    },
    required: ["request"],
    additionalProperties: false,
  },
} as const;
