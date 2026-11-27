import { AUTONOMY_DIRECTIVE, AUTONOMY_DIRECTIVE_VERSION } from "./directive";
import { identityLayers, loadAgentIdentity } from "./identity";
import { composePrompt, type ComposedPrompt } from "./prompt-composer";
import type { PromptLayerInput } from "./prompt-layers";
import { listActiveGrants } from "./authority-store";
import { summarizeAuthority } from "./authority-summary";
import { recordComposition } from "./prompt-record";

/** Runtimes that keep conversation state server-side, so a layer delivered once stays in context. */
const STATEFUL_RUNTIMES = new Set(["hermes"]);

export const AUTHORITY_SUMMARY_VERSION = "1.0.0";

export interface AgentTurnPromptInput {
  agentId: string;
  workspaceId: string | null;
  runtimeKind: string;
  /** The surface-specific prompt (Lisa loop state, worker task context, direct message...). */
  taskPrompt: string;
  surface: string;
  /** Layer hashes this session already holds (AgentSession.metadata.promptLayersDelivered). */
  delivered?: readonly string[];
  /** Extra layers a surface contributes (objectives, environment...). */
  extraLayers?: PromptLayerInput[];
}

export interface AgentTurnPrompt {
  composed: ComposedPrompt;
  /** Updated delivered-hash list to persist on the session (stateful runtimes only). */
  delivered: string[] | null;
}

/**
 * Wraps one agent turn's prompt in the canonical stack: Sentinel directive ->
 * the agent's own identity -> its standing authority -> the turn's content.
 * On stateful runtimes, stable layers already delivered to the session are
 * not resent.
 */
export async function composeAgentTurnPrompt(input: AgentTurnPromptInput): Promise<AgentTurnPrompt> {
  const [identity, grants] = await Promise.all([
    loadAgentIdentity(input.agentId),
    input.workspaceId ? listActiveGrants(input.workspaceId).catch(() => []) : Promise.resolve([]),
  ]);
  const stateful = STATEFUL_RUNTIMES.has(input.runtimeKind);
  const layers: PromptLayerInput[] = [
    { id: "directive", source: "sentinel", version: AUTONOMY_DIRECTIVE_VERSION, content: AUTONOMY_DIRECTIVE },
    ...identityLayers(identity),
    ...(input.workspaceId ? [{ id: "authority" as const, source: "sentinel" as const, version: AUTHORITY_SUMMARY_VERSION, title: "Delegated authority", content: summarizeAuthority(input.agentId, input.workspaceId, grants), maxChars: 3_000 }] : []),
    ...(input.extraLayers ?? []),
    { id: "task", source: "runtime", content: input.taskPrompt },
  ];
  const alreadyInContext = stateful ? new Set(input.delivered ?? []) : undefined;
  const composed = composePrompt(layers, { alreadyInContext });
  await recordComposition({ agentId: input.agentId, workspaceId: input.workspaceId, surface: input.surface, composed });
  // Only stable layers are worth remembering; the task layer changes every turn.
  const delivered = stateful
    ? [...new Set([...(input.delivered ?? []), ...composed.layers.filter((l) => (l.status === "included" || l.status === "already_in_context") && l.id !== "task" && l.id !== "authority").map((l) => l.hash)])].slice(-32)
    : null;
  return { composed, delivered };
}
