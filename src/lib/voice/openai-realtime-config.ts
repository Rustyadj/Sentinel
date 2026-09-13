export const OPENAI_REALTIME_MINI_MODEL = "gpt-realtime-2.1-mini";
export const OPENAI_REALTIME_FULL_MODEL = "gpt-realtime-2.1";
export const OPENAI_LIVE_TRANSCRIPTION_MODEL = "gpt-live-transcribe";
export const OPENAI_REALTIME_ESCALATION_TOOL = "escalate_reasoning";

export type OpenAIRealtimeAgentId = "hermes-lisa" | "nathan2";

export interface OpenAIRealtimeModelConfig {
  miniModel: string;
  fullModel: string;
  transcriptionModel: string;
  voice: string;
}

export function getOpenAIRealtimeModelConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): OpenAIRealtimeModelConfig {
  return {
    miniModel: env.OPENAI_REALTIME_MINI_MODEL?.trim() || OPENAI_REALTIME_MINI_MODEL,
    fullModel: env.OPENAI_REALTIME_FULL_MODEL?.trim() || OPENAI_REALTIME_FULL_MODEL,
    transcriptionModel:
      env.OPENAI_REALTIME_TRANSCRIPTION_MODEL?.trim() || OPENAI_LIVE_TRANSCRIPTION_MODEL,
    voice: env.OPENAI_REALTIME_VOICE?.trim() || "marin",
  };
}

export function resolveOpenAIRealtimeAgentId(agentId?: string): OpenAIRealtimeAgentId | null {
  const normalized = agentId?.trim().toLowerCase();
  if (!normalized || normalized === "hermes-lisa" || normalized === "lisa") return "hermes-lisa";
  if (normalized === "nathan2" || normalized === "nathan" || normalized === "hermes-nathan2") {
    return "nathan2";
  }
  return null;
}

export function openAIRealtimeInstructions(agentId: OpenAIRealtimeAgentId): string {
  const identity = agentId === "nathan2"
    ? "You are Hermes Nathan2, the MobileOps ICF field-operations specialist. Be warm, direct, concise, and action-oriented. Never claim an operational action was completed unless the supplied context or a tool result proves it."
    : "You are Hermes Lisa, the chief orchestrator for Sentinel OS. Be warm, concise, natural, and decisive. Coordinate clearly and preserve the user's intent.";

  return `${identity}

You are in a live spoken conversation. Prefer short, natural answers. Ask only one clarification at a time. Never read markdown syntax aloud.

Use your fast default reasoning for greetings, factual questions, summaries, routine planning, and ordinary conversation. Call ${OPENAI_REALTIME_ESCALATION_TOOL} before answering only when the current turn genuinely requires multi-step reasoning, difficult tradeoffs, ambiguous synthesis, or high-impact judgment. Do not escalate for length alone. After the tool succeeds, answer the same user turn once; do not repeat the tool call.`;
}

export const OPENAI_REALTIME_ESCALATION_TOOL_DEFINITION = {
  type: "function",
  name: OPENAI_REALTIME_ESCALATION_TOOL,
  description:
    "Temporarily move the current turn from the fast mini model to the full realtime model. Use only for genuinely complex multi-step reasoning, difficult tradeoffs, ambiguous synthesis, or high-impact judgment.",
  parameters: {
    type: "object",
    properties: {
      reason: {
        type: "string",
        description: "A short internal explanation of why the full model is required.",
      },
    },
    required: ["reason"],
    additionalProperties: false,
  },
} as const;
