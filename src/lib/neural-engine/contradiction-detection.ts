// Sentinel — contradiction detection.
//
// The benchmark's phase-7 run exposed a real regression: a superseded belief
// surfaced alongside the correction that replaced it. The cause was not
// ranking. `mem-sentinel-port-old` was excluded correctly because supersession
// had been *recorded* on it (validTo + supersededById); `mem-sentinel-model-old`
// was not excluded because the correction that replaced it had been ingested as
// an independent memory and nothing ever linked the two.
//
// So this module answers one question, for one pair of memories: does the
// newer one contradict the older one, and if so what should happen to the
// older one. It does not read or write the database, and it does not filter
// anything at retrieval time. It is the judgement; applying it is
// reconsolidation-service's job, and retrieval only ever reads the result.
//
// Two failure modes are guarded against explicitly, because both are worse
// than missing a contradiction:
//
//   1. Treating every difference as a contradiction. "The truck was red in
//      2025" and "the truck is blue now" are both true. Superseding the first
//      destroys history to no benefit.
//   2. Letting one scope overwrite another. A project-scoped fact must never
//      supersede a global convention that merely shares vocabulary with it.
//
// Consequently every gate below is a *reason to do nothing*, and SUPERSEDE
// requires positive evidence rather than the absence of an objection.

import { DUPLICATE_SIMILARITY_THRESHOLD } from "./ingestion-gate";
import { tokenize } from "@/lib/knowledge/retrieval-ranking";

/**
 * What reconsolidation should do with the *existing* memory in the light of
 * the incoming one.
 *
 * REINFORCE   — same claim again; raise confirmation, change nothing else.
 * REVISE      — same claim, materially better stated; content may be updated.
 * SUPERSEDE   — the incoming memory replaces it. The existing row is closed
 *               bitemporally (validTo) and linked (supersededById). It is NOT
 *               deleted and stays retrievable by historical queries.
 * MERGE       — two partial statements of one fact that belong together.
 * QUARANTINE  — the existing memory is probably false and must leave retrieval.
 * ARCHIVE     — no longer applicable, but not wrong.
 * NO_CHANGE   — nothing follows from this pair.
 */
export type ReconsolidationAction =
  | "REINFORCE"
  | "REVISE"
  | "SUPERSEDE"
  | "MERGE"
  | "QUARANTINE"
  | "ARCHIVE"
  | "NO_CHANGE";

/** A memory as this module needs to see it. Deliberately narrow: anything not
 *  listed here cannot influence the judgement, which keeps the decision
 *  reproducible from what gets stored alongside it. */
export interface ComparableMemory {
  id: string;
  content: string;
  tags: string[];
  scope: string;
  projectId: string | null;
  owner: string;
  confidence: number | null;
  createdAt: Date;
  validFrom: Date;
  validTo: Date | null;
  provenanceClass: string;
  source: string;
}

/** One named observation that moved (or blocked) the decision. Stored verbatim
 *  so "why did this belief change" is answerable from data rather than from a
 *  model being asked to remember its own reasoning. */
export interface ContradictionEvidence {
  code: string;
  detail: string;
  /** Signed contribution to the supersession case: positive supports it. */
  weight: number;
}

export interface ContradictionAssessment {
  action: ReconsolidationAction;
  /** 0..1 in how far the evidence supports the action. */
  confidence: number;
  /** True when the pair genuinely conflicts but nothing resolves which side
   *  wins. Both memories stay retrievable and a Contradiction is opened. A
   *  silent pick between two live claims is a worse answer than both. */
  opensContradiction: boolean;
  evidence: ContradictionEvidence[];
  /** Short human-readable summary, persisted as Memory.changeReason. */
  reason: string;
}

// --- Signals -------------------------------------------------------------

/** Content that announces itself as correcting something earlier. */
const CORRECTION_MARKERS = [
  /^\s*(correction|update|clarification|amended|revised)\s*[:\-—]/i,
  /\b(?:i was|that was|this was) (?:wrong|incorrect|mistaken)\b/i,
  /\bactually,?\s/i,
];

/** Constructions that replace a previous value with a new one. The captured
 *  group is the value being *displaced*, which is the strongest available
 *  evidence: if it appears in the older memory, the two are about the same
 *  attribute and the newer one is explicitly retiring the older's value. */
const REPLACEMENT_PATTERNS = [
  /\bnot\s+([a-z0-9][a-z0-9._-]*)/gi,
  /\bno longer\s+([a-z0-9][a-z0-9._-]*)/gi,
  /\binstead of\s+([a-z0-9][a-z0-9._-]*)/gi,
  /\brather than\s+([a-z0-9][a-z0-9._-]*)/gi,
  /\b(?:used to be|previously|formerly|was)\s+([a-z0-9][a-z0-9._-]*)/gi,
];

/** Statements explicitly bound to a period. A memory that says when it was
 *  true is not contradicted by one describing now — that is history, not
 *  conflict, and is the single most important false positive to avoid. */
const PERIOD_BOUND_PATTERNS = [
  /\b(?:in|during|throughout|as of|until|up to|through)\s+(?:19|20)\d{2}\b/i,
  /\b(?:back in|prior to|before)\s+\w+/i,
  /\b(?:was|were|had been|used to be)\b/i,
];

/** Statements asserting the present. */
const PRESENT_TENSE_PATTERNS = [
  /\b(?:is|are|now|currently|today|these days)\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function hasCorrectionMarker(memory: Pick<ComparableMemory, "content" | "tags">): boolean {
  if (memory.tags.some((tag) => /^(correction|supersedes|fix|amend)$/i.test(tag))) return true;
  return matchesAny(memory.content, CORRECTION_MARKERS);
}

/** Values this memory explicitly displaces, lowercased. */
export function displacedValues(content: string): string[] {
  const found = new Set<string>();
  for (const pattern of REPLACEMENT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of content.matchAll(pattern)) {
      // The capture runs to the end of an identifier-ish token, which sweeps
      // up the sentence's full stop ("provider-a."). Left in, it would never
      // match the token as the older memory stores it.
      const value = match[1]?.toLowerCase().replace(/[.,;:]+$/, "");
      if (value && value.length > 1) found.add(value);
    }
  }
  return [...found];
}

/**
 * How much of the *distinctive* subject the two memories share.
 *
 * Plain token overlap is not enough: two memories about Sentinel share
 * "sentinel" without being about the same thing. Weighting by how rare a token
 * is within the pair, and requiring the shared tokens to carry most of the
 * shorter memory, is what separates "same attribute of the same entity" from
 * "same general topic".
 */
export function subjectOverlap(a: string, b: string): number {
  const left = new Set(terms(a));
  const right = new Set(terms(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / Math.min(left.size, right.size);
}

/** Tokens that appear in one memory and not the other — candidate attribute
 *  values, which is where a genuine disagreement shows up. */
export function distinguishingTokens(a: string, b: string): string[] {
  const right = new Set(terms(b));
  return [...new Set(terms(a))].filter((token) => !right.has(token));
}

/**
 * The shared tokenizer treats "." and "-" as part of a token so identifiers
 * survive intact ("icfops.example", "claude-3-opus", "SNTL-4471"). That is
 * right for ranking and wrong here: it makes a sentence-final "embeddings."
 * a different token from "embeddings", so two memories about the same subject
 * can score an overlap of 0.33 purely on where the full stops fell.
 *
 * Trailing punctuation is stripped for comparison only. The shared tokenizer
 * is deliberately left alone — it feeds the ranking the benchmark measures.
 */
function terms(text: string): string[] {
  return tokenize(text)
    .map((token) => token.replace(/[.,;:!?]+$/, ""))
    .filter((token) => token.length > 1);
}

/** Jaccard over the *stemmed* tokens, so an inflection is not mistaken for a
 *  different claim. `contentSimilarity` does no stemming by design (it is the
 *  ingestion gate's cheap duplicate screen); this needs the stricter reading. */
export function stemmedSimilarity(a: string, b: string): number {
  const left = new Set(terms(a));
  const right = new Set(terms(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared++;
  return shared / new Set([...left, ...right]).size;
}

/** Tokens carrying a digit — ports, TTLs, versions, model names, error codes.
 *  These are where two otherwise identical sentences actually disagree. */
export function valueTokens(content: string): Set<string> {
  return new Set(terms(content).filter((token) => /\d/.test(token)));
}

/** True when both memories name values and share none of them. */
export function valueDivergence(a: string, b: string): boolean {
  const left = valueTokens(a);
  const right = valueTokens(b);
  if (left.size === 0 || right.size === 0) return false;
  for (const token of left) if (right.has(token)) return false;
  return true;
}

const SUBJECT_OVERLAP_THRESHOLD = 0.5;

// --- Assessment ----------------------------------------------------------

function verdict(
  action: ReconsolidationAction,
  confidence: number,
  reason: string,
  evidence: ContradictionEvidence[],
  opensContradiction = false,
): ContradictionAssessment {
  return { action, confidence, reason, evidence, opensContradiction };
}

/**
 * Assess what the arrival of `incoming` means for `existing`.
 *
 * Ordering is the safety property: every gate that can rule the pair out runs
 * before any gate that can act on it, so no amount of surface similarity can
 * reach SUPERSEDE past a scope or valid-time objection.
 */
export function assessContradiction(
  incoming: ComparableMemory,
  existing: ComparableMemory,
): ContradictionAssessment {
  const evidence: ContradictionEvidence[] = [];

  if (incoming.id === existing.id) {
    return verdict("NO_CHANGE", 1, "same memory", [
      { code: "same_memory", detail: "a memory cannot supersede itself", weight: 0 },
    ]);
  }

  // --- Gate 1: compatible scope ------------------------------------------
  // A project fact must not retire a workspace or global one. Requiring the
  // *same* scope and project is stricter than necessary in theory and exactly
  // right in practice: cross-scope supersession has no safe default, so it is
  // left to a human rather than guessed.
  if (incoming.scope !== existing.scope || incoming.projectId !== existing.projectId) {
    return verdict("NO_CHANGE", 1, "different scope", [
      {
        code: "scope_incompatible",
        detail: `${incoming.scope}/${incoming.projectId ?? "-"} vs ${existing.scope}/${existing.projectId ?? "-"}`,
        weight: 0,
      },
    ]);
  }
  if (incoming.owner !== existing.owner) {
    return verdict("NO_CHANGE", 1, "different owner", [
      { code: "owner_mismatch", detail: "memories belong to different owners", weight: 0 },
    ]);
  }
  evidence.push({ code: "scope_compatible", detail: `both ${existing.scope}`, weight: 0 });

  // --- Gate 2: overlapping valid time ------------------------------------
  // An already-closed memory has nothing left to supersede.
  if (existing.validTo !== null && existing.validTo <= incoming.validFrom) {
    return verdict("NO_CHANGE", 1, "existing memory was already closed", [
      { code: "no_valid_time_overlap", detail: `existing validTo ${existing.validTo.toISOString()}`, weight: 0 },
    ]);
  }
  evidence.push({ code: "valid_time_overlap", detail: "both were valid at the same time", weight: 0 });

  // --- Gate 3: the existing memory is explicitly about a past period ------
  // "The truck was red in 2025" is not contradicted by "the truck is blue".
  const existingIsPeriodBound = matchesAny(existing.content, PERIOD_BOUND_PATTERNS);
  const incomingIsPresent = matchesAny(incoming.content, PRESENT_TENSE_PATTERNS);
  if (existingIsPeriodBound && incomingIsPresent) {
    return verdict("NO_CHANGE", 0.9, "existing memory is scoped to a past period", [
      ...evidence,
      {
        code: "existing_period_bound",
        detail: "existing states a past period; incoming states the present — both can be true",
        weight: 0,
      },
    ]);
  }

  // --- Gate 4: same subject ----------------------------------------------
  const overlap = subjectOverlap(incoming.content, existing.content);
  if (overlap < SUBJECT_OVERLAP_THRESHOLD) {
    return verdict("NO_CHANGE", 1 - overlap, "different subject", [
      ...evidence,
      { code: "subject_mismatch", detail: `subject overlap ${overlap.toFixed(2)}`, weight: 0 },
    ]);
  }
  evidence.push({ code: "same_subject", detail: `subject overlap ${overlap.toFixed(2)}`, weight: 0.2 });

  // --- Duplicate ----------------------------------------------------------
  // Same claim twice is evidence, not conflict.
  //
  // Measured over stemmed tokens rather than raw ones: "Sentinel deploys via
  // docker compose" and "Sentinel is deployed using docker compose" are the
  // same fact, and a raw Jaccard scores them 0.60 purely on "deploys" vs
  // "deployed".
  //
  // And a duplicate must agree on its values. "The cache TTL is 60 seconds"
  // and "...is 300 seconds" share almost every word and assert opposite
  // things; counting them as a duplicate would file a live disagreement away
  // as a confirmation, which is the most damaging thing this module could do.
  const similarity = stemmedSimilarity(incoming.content, existing.content);
  const divergentValues = valueDivergence(incoming.content, existing.content);
  if (divergentValues) {
    evidence.push({
      code: "value_divergence",
      detail: "the two memories assert different values for the same subject",
      weight: 0.2,
    });
  }
  if (similarity >= DUPLICATE_SIMILARITY_THRESHOLD && !divergentValues) {
    return verdict("REINFORCE", similarity, "restates an existing memory", [
      ...evidence,
      { code: "near_duplicate", detail: `content similarity ${similarity.toFixed(2)}`, weight: 0 },
    ]);
  }

  // --- Positive evidence for supersession --------------------------------
  const marked = hasCorrectionMarker(incoming);
  if (marked) {
    evidence.push({ code: "correction_marker", detail: "incoming announces itself as a correction", weight: 0.4 });
  }

  // Both sides go through terms(), so a value written at the end of a sentence
  // still matches the same value written mid-sentence.
  const displaced = displacedValues(incoming.content);
  const existingTokens = new Set(terms(existing.content));
  const displacesExistingValue = displaced.filter((value) => existingTokens.has(value));
  if (displacesExistingValue.length > 0) {
    evidence.push({
      code: "displaces_existing_value",
      detail: `incoming explicitly retires "${displacesExistingValue.join('", "')}", which the existing memory asserts`,
      weight: 0.5,
    });
  }

  const newer = incoming.createdAt > existing.createdAt;
  if (newer) evidence.push({ code: "incoming_newer", detail: "incoming was recorded later", weight: 0.1 });

  const incomingConfidence = incoming.confidence ?? 0.5;
  const existingConfidence = existing.confidence ?? 0.5;
  if (incomingConfidence > existingConfidence) {
    evidence.push({
      code: "higher_source_confidence",
      detail: `${incomingConfidence.toFixed(2)} > ${existingConfidence.toFixed(2)}`,
      weight: 0.1,
    });
  }

  const support = evidence.reduce((sum, item) => sum + item.weight, 0);

  // Supersession needs the newer memory to be later AND to explicitly retire
  // what the older one said — either by announcing itself as a correction or
  // by naming the value it displaces. One signal alone is not enough: a
  // "correction" that corrects something else entirely would otherwise close a
  // memory it never mentioned.
  if (newer && (displacesExistingValue.length > 0) && (marked || support >= 0.8)) {
    return verdict(
      "SUPERSEDE",
      Math.min(1, support),
      `superseded by a correction that explicitly retires "${displacesExistingValue.join('", "')}"`,
      evidence,
    );
  }
  if (newer && marked && support >= 0.7) {
    return verdict("SUPERSEDE", Math.min(1, support), "superseded by an explicit correction on the same subject", evidence);
  }

  // --- Unresolved conflict ------------------------------------------------
  // Same subject, no shared claim, and nothing says which side wins. Both stay
  // retrievable and a Contradiction records the disagreement. Silently picking
  // the newer one here is the failure this whole module exists to avoid: it
  // would be indistinguishable from a recorded supersession while resting on
  // no evidence at all.
  const differing = distinguishingTokens(incoming.content, existing.content);
  if (differing.length > 0 && similarity >= 0.35) {
    return verdict(
      "NO_CHANGE",
      0.5,
      "same subject, competing claims, no evidence of which supersedes",
      [
        ...evidence,
        {
          code: "unresolved_conflict",
          detail: `differing terms: ${differing.slice(0, 5).join(", ")}`,
          weight: 0,
        },
      ],
      true,
    );
  }

  return verdict("NO_CHANGE", 0.6, "related but not contradictory", [
    ...evidence,
    { code: "no_conflict_signal", detail: "same subject but no competing claim detected", weight: 0 },
  ]);
}
