// Sentinel — is this question about what is true, or about what was true?
//
// Retrieval has been excluding superseded memories with a blanket
// `validTo: null` filter. That is right for almost every question and wrong
// for the ones that matter most about a memory system: "what were we using
// before the switch?" could not be answered at all, because the only memory
// that could answer it was unconditionally invisible.
//
// The fix is not to stop filtering. A memory that has been corrected must not
// come back as current truth. The fix is to make the filter depend on what was
// asked — so this module decides that, and nothing else.
//
// It is deliberately conservative. Misreading a current-truth question as
// historical reintroduces exactly the false retrieval Phase 8 exists to remove,
// so a cue has to be explicit: a bare past-tense verb is not enough, because
// "What database did Sentinel use for the migration?" is a question about now.

export type TemporalIntent =
  /** What is true today. Superseded beliefs are excluded. */
  | "current"
  /** What was true before. Superseded beliefs are in scope and preferred. */
  | "historical"
  /** What was true at a stated point. Superseded beliefs are in scope. */
  | "as_of";

export interface TemporalIntentResult {
  intent: TemporalIntent;
  /** Set for "as_of" when a point in time could be parsed. */
  asOf: Date | null;
  /** The cue that decided it, recorded so a surprising result is explicable. */
  matched: string | null;
}

/**
 * Explicit appeals to a previous state of the world.
 *
 * Each requires more than past tense: a comparative ("before", "previously"),
 * a change verb ("switched", "changed", "migrated") paired with a look-back, or
 * a direct question about prior belief.
 */
const HISTORICAL_CUES: Array<[RegExp, string]> = [
  [/\bwhat (?:were|was) (?:we|it|they|you|i) (?:using|doing|running|on)\b/i, "what were we using"],
  [/\bused to\b/i, "used to"],
  [/\b(?:previously|formerly|originally|beforehand)\b/i, "previously"],
  [/\bbefore (?:the |we |it |they |that |this )?\w*\s*(?:switch|change|migration|move|upgrade|correction|update|swap)\b/i, "before the switch"],
  [/\bprior to (?:the|our|that|this)\b/i, "prior to"],
  [/\bwhat did (?:we|you|sentinel|it) (?:believe|think|assume|use|have)\b/i, "what did we believe"],
  [/\b(?:superseded|outdated|old|former|previous|earlier) (?:value|belief|answer|version|setting|config|configuration)\b/i, "previous value"],
  [/\bhistory of\b/i, "history of"],
  [/\bno longer (?:true|valid|correct|the case)\b/i, "no longer true"],
  [/\bat the time\b/i, "at the time"],
  [/\bback (?:then|when)\b/i, "back then"],
];

/** A stated point in time to evaluate the world against. */
const AS_OF_CUES: Array<[RegExp, string]> = [
  [/\bas of\s+([^,.?]+)/i, "as of"],
  [/\bwhat (?:was|were)[^?]*\b(?:in|on|during)\s+((?:19|20)\d{2}(?:-\d{2}-\d{2})?)/i, "what was in <year>"],
  [/\b(?:back )?in\s+((?:19|20)\d{2})\b/i, "in <year>"],
];

function parsePoint(raw: string): Date | null {
  const text = raw.trim();
  const iso = text.match(/(?:19|20)\d{2}(?:-\d{2}(?:-\d{2})?)?/);
  if (iso) {
    const parsed = new Date(iso[0].length === 4 ? `${iso[0]}-01-01T00:00:00.000Z` : `${iso[0]}T00:00:00.000Z`);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Classify a query's temporal intent.
 *
 * Historical is checked before as-of: "what were we using before the 2026
 * migration?" is a look-back, and treating it as a point query would anchor it
 * to a date the asker mentioned only to locate the change.
 */
export function classifyTemporalIntent(query: string | null | undefined): TemporalIntentResult {
  const text = (query ?? "").trim();
  if (!text) return { intent: "current", asOf: null, matched: null };

  for (const [pattern, label] of HISTORICAL_CUES) {
    if (pattern.test(text)) return { intent: "historical", asOf: null, matched: label };
  }
  for (const [pattern, label] of AS_OF_CUES) {
    const match = text.match(pattern);
    if (match) return { intent: "as_of", asOf: parsePoint(match[1] ?? ""), matched: label };
  }
  return { intent: "current", asOf: null, matched: null };
}

/** Whether superseded (bitemporally closed) memories may be returned at all. */
export function includesSupersededMemories(intent: TemporalIntent): boolean {
  return intent !== "current";
}

// --- Ordering ------------------------------------------------------------
//
// A second, independent axis. "Walk me through the rollout in order" is a
// current-truth question that nonetheless wants its answer sequenced, so this
// is deliberately not folded into TemporalIntent: a query can be current and
// chronological, or historical and chronological, and collapsing the two would
// force a choice that does not exist.

/** Queries that want their answer sequenced rather than ranked. */
const ORDERING_CUES: Array<[RegExp, string]> = [
  [/\bin (?:what |which )?order\b/i, "in order"],
  [/\bwhat happened (?:first|next|then|after|before)\b/i, "what happened first"],
  [/\bwalk me through\b/i, "walk me through"],
  [/\b(?:step by step|chronologically|in sequence|timeline|sequence of events)\b/i, "chronologically"],
  [/\bthe (?:first|last) thing (?:we|you|i|they)\b/i, "the last thing we"],
  [/\bwhat (?:changed|happened) between\b/i, "what changed between"],
  [/\bwhat (?:came|happened) (?:after|before)\b/i, "what came after"],
  [/\bin the order (?:they|it|we)\b/i, "in the order they"],
];

/**
 * Whether this question wants a sequence.
 *
 * Returns the cue that matched, or null. Conservative for the same reason as
 * the rest of this module: reordering a ranked result set by time is right for
 * "walk me through the rollout" and wrong for "what is the deployment port",
 * where it would put the oldest weak match first.
 */
export function orderingCue(query: string | null | undefined): string | null {
  const text = (query ?? "").trim();
  if (!text) return null;
  for (const [pattern, label] of ORDERING_CUES) {
    if (pattern.test(text)) return label;
  }
  return null;
}

/**
 * The time a memory's content is *about*.
 *
 * eventTime when the memory records an event; otherwise validFrom, when the
 * belief became true. createdAt is the last resort and is explicitly not
 * preferred: it is when the row was inserted, which for anything recalled
 * later is the order it was remembered in, not the order it happened.
 */
export function effectiveEventTime(memory: {
  eventTime?: Date | null;
  validFrom?: Date | null;
  createdAt: Date;
}): Date {
  return memory.eventTime ?? memory.validFrom ?? memory.createdAt;
}
