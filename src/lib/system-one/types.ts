/**
 * System 1 — Sentinel's reflex layer.
 *
 * A System 1 provider answers typed questions about a request (which kind of
 * thing is happening, which path should handle it, whether memory, a tool or
 * real reasoning is needed). It never writes prose and never answers the user;
 * it only routes. See docs/decisions.md ADR-004 and docs/SYSTEM_ONE.md.
 */

export type SystemOneMode = "off" | "shadow" | "active";
export type SystemOneSurface = "chat" | "runtime_chat" | "voice";

/** Provider-neutral question shapes. Jev's wire format is a superset of these. */
export type SystemOneQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "score"; instructions: string; criteria: string[] };

export type SystemOneAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
  | { type: "noul"; noul: number }
  | { type: "score"; score: number; probabilities: Record<string, number>; confidence: number; levels: number };

export interface SystemOneProviderRequest {
  state: Record<string, unknown>;
  questions: Record<string, SystemOneQuestion>;
}

export interface SystemOneProviderResponse {
  answers: Record<string, SystemOneAnswer>;
  /** Versioned model id that actually answered, as reported by the provider. */
  model: string;
  inputTokens: number;
  /** Provider-reported cost; null when the provider does not report one. */
  costUsd: number | null;
}

export interface SystemOneProvider {
  readonly name: string;
  evaluate(request: SystemOneProviderRequest, signal: AbortSignal): Promise<SystemOneProviderResponse>;
}

/** The single path every request class maps onto. Paths, never models (ADR-004). */
export const SYSTEM_ONE_ROUTES = {
  fast_reply: "A greeting, thanks, acknowledgement or small talk that needs no facts, data or work",
  tool_read: "A factual lookup answered by reading current data from one of `available_tools`, with nothing to change",
  memory_answer: "Recalling something previously said, decided or stored about the user, a project or a person",
  agent_runtime: "Anything needing judgement, writing, planning, several steps, code, or a change to data",
  clarify: "The request is too ambiguous to act on without asking the user what they mean",
} as const;
export type SystemOneRoute = keyof typeof SYSTEM_ONE_ROUTES;

export const SYSTEM_ONE_INTENTS = {
  small_talk: "Greeting, thanks, acknowledgement or casual conversation",
  status_query: "Asking about the current state of agents, tasks, systems or operations",
  inventory_lookup: "Asking about equipment, stock, rentals, bookings, dispatches or maintenance records",
  memory_recall: "Asking what was said, decided, stored or known earlier",
  web_search: "Needs current information from the public internet",
  coding: "Writing, reviewing, debugging or changing code or a repository",
  task_orchestration: "Creating, assigning, starting or coordinating tasks or other agents",
  write_action: "Asking to create, update, delete, send, book, assign or otherwise change something",
  multi_step_reasoning: "Analysis, planning, comparison or a question needing several steps of thought",
  other: "None of the above",
} as const;
export type SystemOneIntent = keyof typeof SYSTEM_ONE_INTENTS;

/** A read-only tool the requesting agent holds a credential for. */
export interface ReadOnlyToolDescriptor {
  /** Stable id the provider chooses between: `<connector>.<tool>`. */
  id: string;
  connector: string;
  name: string;
  description: string;
  /**
   * Arguments System 1 is allowed to fill, one Choice per argument. A tool with
   * a required argument outside this set is never fast-path eligible, because
   * System 1 chooses — it cannot extract free text.
   */
  enumArguments: Record<string, string[]>;
  requiredArguments: string[];
  fastPathEligible: boolean;
}

export interface SystemOneDecision {
  intent: SystemOneIntent;
  route: SystemOneRoute;
  needsMemory: number;
  needsTool: number;
  needsSearch: number;
  needsSystem2: number;
  needsClarification: number;
  /** P(the request only reads data and changes nothing). */
  readOnly: number;
  /** 0–1, normalised from the provider's score. */
  complexity: number;
  urgency: number;
  suggestedTool: string | null;
  suggestedToolArguments: Record<string, string>;
  /** Always the agent's configured model. Present for the record, never chosen (ADR-004). */
  suggestedModel: string | null;
  /** Confidence of the route choice — the one that gates action. */
  confidence: number;
  confidences: { intent: number; route: number; tool: number | null };
}

export type SystemOneOutcome =
  | "ok"
  | "disabled"
  | "timeout"
  | "error"
  | "malformed"
  | "circuit_open"
  | "aborted";

export interface SystemOneResult {
  outcome: SystemOneOutcome;
  decision: SystemOneDecision | null;
  provider: string;
  providerModel: string | null;
  latencyMs: number;
  inputTokens: number;
  costUsd: number | null;
  error?: string;
}

export type ConfidenceTier = "high" | "medium" | "low";

export type RoutingAction =
  /** Execute a read-only tool and return its structured result; no System 2. */
  | "fast_path_tool"
  /** Proceed to System 2 without waiting for memory retrieval. */
  | "system2_skip_memory"
  /** Today's path, unchanged. */
  | "system2";

export interface RoutingPlan {
  action: RoutingAction;
  tier: ConfidenceTier;
  tool: ReadOnlyToolDescriptor | null;
  toolArguments: Record<string, string>;
  reasons: string[];
}
