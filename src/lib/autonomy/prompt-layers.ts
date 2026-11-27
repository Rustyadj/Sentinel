/**
 * Client-safe half of the prompt composition engine: layer vocabulary,
 * version comparison, and the redundant-restriction lint. The server-side
 * composer (prompt-composer.ts) adds hashing and persistence.
 */

/** Canonical prompt stack order. Layers are always emitted in this order. */
export const PROMPT_LAYER_ORDER = [
  "directive",
  "identity",
  "personality",
  "specialization",
  "objectives",
  "memory",
  "capabilities",
  "authority",
  "environment",
  "task",
] as const;
export type PromptLayerId = (typeof PROMPT_LAYER_ORDER)[number];

/**
 * Who authored a layer. Only `sentinel` layers are Sentinel's own
 * contribution; `agent`/`operator` layers are the agent's configured identity
 * or an explicit operator/user instruction (preserved verbatim, category 3 in
 * the autonomy audit), `runtime`/`user` are live context.
 */
export type PromptLayerSource = "sentinel" | "agent" | "operator" | "runtime" | "user";

export interface PromptLayerInput {
  id: PromptLayerId;
  source: PromptLayerSource;
  content: string | null | undefined;
  /** Version of the layer's template/definition (e.g. the directive version). */
  version?: string;
  /** Optional heading rendered above the layer. */
  title?: string;
  /** Per-layer budget; content past it is truncated with a marker. */
  maxChars?: number;
}

export interface ComposedLayerManifest {
  id: PromptLayerId;
  source: PromptLayerSource;
  version: string | null;
  hash: string;
  chars: number;
  truncated: boolean;
  /** "included" | "empty" | "duplicate" (same content as an earlier layer) | "already_in_context" */
  status: "included" | "empty" | "duplicate" | "already_in_context";
}

export interface LayerDiffEntry {
  id: PromptLayerId;
  change: "added" | "removed" | "changed" | "unchanged";
  before?: { version: string | null; hash: string; chars: number };
  after?: { version: string | null; hash: string; chars: number };
}

/** Layer-by-layer comparison of two compositions' manifests. */
export function diffCompositions(before: readonly ComposedLayerManifest[], after: readonly ComposedLayerManifest[]): LayerDiffEntry[] {
  const included = (list: readonly ComposedLayerManifest[]) => new Map(list.filter((l) => l.status === "included").map((l) => [l.id, l]));
  const a = included(before);
  const b = included(after);
  return PROMPT_LAYER_ORDER.flatMap((id): LayerDiffEntry[] => {
    const x = a.get(id);
    const y = b.get(id);
    if (!x && !y) return [];
    const pick = (l: ComposedLayerManifest) => ({ version: l.version, hash: l.hash, chars: l.chars });
    if (!x) return [{ id, change: "added", after: pick(y!) }];
    if (!y) return [{ id, change: "removed", before: pick(x) }];
    return [{ id, change: x.hash === y.hash ? "unchanged" : "changed", before: pick(x), after: pick(y) }];
  });
}

/**
 * Phrases that, when Sentinel itself injects them, impose a restriction the
 * model provider and the authority system already handle (or invent one).
 * Used to (a) prove Sentinel's own layers contain none and (b) flag them in
 * operator-written prompts for review — operator text is never auto-edited,
 * because an explicit operator restriction must be preserved.
 */
const REDUNDANT_RESTRICTION_PATTERNS: { code: string; pattern: RegExp }[] = [
  { code: "blanket_refusal", pattern: /\b(you must|always) refuse\b/i },
  { code: "ai_disclaimer", pattern: /\bas an ai( language model)?\b/i },
  { code: "per_action_confirmation", pattern: /\b(always|must) (ask|confirm with) (the )?(user|human|operator) (before|for permission)/i },
  { code: "no_action_without_approval", pattern: /\bdo not (take|perform) any action without (explicit )?(approval|permission)\b/i },
  { code: "generic_safety_moderation", pattern: /\b(avoid|refuse) (any )?(harmful|sensitive|controversial) (content|topics)\b/i },
  { code: "invented_capability_limit", pattern: /\byou (cannot|can't|are unable to) (browse|access the internet|run code|use tools)\b/i },
];

export interface RestrictionFinding { code: string; excerpt: string }

export function findRedundantRestrictions(text: string): RestrictionFinding[] {
  const findings: RestrictionFinding[] = [];
  for (const { code, pattern } of REDUNDANT_RESTRICTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      const start = Math.max(0, (match.index ?? 0) - 40);
      findings.push({ code, excerpt: text.slice(start, (match.index ?? 0) + match[0].length + 40).trim() });
    }
  }
  return findings;
}
