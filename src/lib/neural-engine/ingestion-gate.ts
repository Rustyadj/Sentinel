// Sentinel — selective persistence gate.
//
// Chat has never written a Memory row. `extractCandidates` exists but is
// reachable only from a manual /api/knowledge/extract call, so in practice
// durable memory arrived from preference evidence, consolidation and manual
// creation — and nothing decided what *not* to keep.
//
// This is the decision point: given something that happened, should Sentinel
// remember it, as what, and why. The "why" is recorded, because a gate whose
// decisions cannot be reviewed cannot be evaluated or improved.
//
// Cost discipline: this is deterministic. It runs on every turn, so an LLM
// call per turn would be both slow and expensive, and most of the decision is
// genuinely rule-shaped — transient chatter, duplicates and secrets do not
// need a model to recognise. `needsModelReview` marks the residual cases a
// classifier could later adjudicate; nothing here pretends a model already did.

export type MemoryLane = "EPISODIC" | "SEMANTIC" | "PROCEDURAL" | "PREFERENCE" | "ENTITY_RELATION";
export type IngestionDecision = "DISCARD" | MemoryLane;

export interface IngestionSignals {
  /** Does this plausibly matter beyond the current turn? */
  futureUsefulness: number;
  /** 1 = nothing like it is stored; 0 = an exact duplicate exists. */
  novelty: number;
  /** How sure we are of the classification itself. */
  confidence: number;
  /** How much the origin is trusted — a user statement outranks an inference. */
  sourceReliability: number;
  /** Does it read as durable, or as a fact with a short shelf life? */
  temporalRelevance: number;
  /** 1 = contains secret-shaped content and must never be stored. */
  sensitivity: number;
}

export interface IngestionVerdict {
  decision: IngestionDecision;
  lane: MemoryLane | null;
  /** Human-readable, ordered, and persisted. This is the audit trail. */
  reasons: string[];
  signals: IngestionSignals;
  /** Composite retrieval-value estimate, 0..1. */
  expectedRetrievalValue: number;
  /** True when deterministic rules were not decisive enough to be trusted. */
  needsModelReview: boolean;
  suggestedScope: "session" | "project" | "user" | "global";
  suggestedImportance: number;
}

export interface IngestionInput {
  content: string;
  /** "user" | "agent" | "system" | "tool" — who asserted it. */
  speaker?: string;
  source?: string;
  projectId?: string | null;
  /** Content of memories already stored in the same scope, for duplicate detection. */
  existingContents?: string[];
}

/** Secret-shaped content is never stored, whatever else it looks like. */
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:sk|ghp|github_pat|xoxb|xoxp|pa)[-_][A-Za-z0-9_-]{16,}/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|secret|api[_-]?key|credential)\s*[:=]\s*\S+/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b.*\b(?:password|token)\b/i,
];

/**
 * Transient conversational material. These are the turns that make a memory
 * system fail by remembering everything: acknowledgements, meta-chatter about
 * the conversation itself, and the model narrating its own process.
 */
const TRANSIENT_PATTERNS: RegExp[] = [
  /^(?:ok(?:ay)?|sure|thanks?|thank you|got it|yes|no|yep|nope|sounds good|perfect|great|nice|cool)\b[\s.!]*$/i,
  /^(?:hi|hello|hey|good (?:morning|afternoon|evening))\b/i,
  /^(?:let me|i'?ll|i am going to|i'?m going to)\s+(?:check|look|see|try|take a look|search|read|run)\b/i,
  /^(?:here'?s|here is) (?:what|the) /i,
  /^(?:one moment|hold on|working on it|still working)\b/i,
  /\b(?:as an ai|i don'?t have access to)\b/i,
];

/** Durable preference statements. */
const PREFERENCE_PATTERNS: RegExp[] = [
  /\bi (?:prefer|like|want|always|never|hate|don'?t like|would rather)\b/i,
  /\b(?:please )?(?:always|never|from now on|going forward|in future)\b.*\b(?:use|do|avoid|write|format|call|name)\b/i,
  /\bmy (?:preferred|usual|default|standard)\b/i,
  /\bdon'?t (?:ever )?(?:use|do|add|include)\b/i,
];

/** Reusable procedure / how-to knowledge. */
const PROCEDURAL_PATTERNS: RegExp[] = [
  /\b(?:to|when you need to|the way to)\s+\w+.*,?\s*(?:you |first |then |run |use )/i,
  /\b(?:steps?|procedure|workflow|runbook|process) (?:is|are|to)\b/i,
  /\bfirst\b.*\bthen\b.*\b(?:finally|lastly|after that)\b/i,
  /\b(?:always|make sure to|remember to|be sure to)\s+\w+.*\bbefore\b/i,
  /\b(?:the fix|the solution|resolved (?:it|this) by|fixed by)\b/i,
];

/** Entity/relationship assertions. */
const ENTITY_RELATION_PATTERNS: RegExp[] = [
  /\b\w+\s+(?:is|are|was|were)\s+(?:the\s+)?(?:owner|maintainer|lead|manager|author|CEO|CTO|CMO|part of|member of|responsible for)\b/i,
  /\b\w+\s+(?:belongs to|reports to|works (?:on|for)|owns|manages|depends on|is used by)\b/i,
  /\b\w+'?s\s+(?:brother|sister|mother|father|team|manager|owner)\b/i,
];

/** Durable factual/semantic knowledge. */
const SEMANTIC_PATTERNS: RegExp[] = [
  /\b(?:is|are|runs on|lives (?:at|in|on)|located|hosted|configured|deployed) (?:at|on|in|with)?\b/i,
  /\b(?:the|our|this) (?:project|repo|service|database|server|api|endpoint|port|domain|branch)\b/i,
  /\b(?:version|port|url|hostname|path|credential-free config)\b/i,
];

/** Short shelf life — true now, not worth remembering. */
const EPHEMERAL_PATTERNS: RegExp[] = [
  /\b(?:currently|right now|at the moment|today|this morning|just now|temporarily)\b/i,
  /\b(?:is running|is down|is up|is failing|is loading|in progress)\b/i,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/** Jaccard over word tokens — the same cheap similarity the retrieval planner uses. */
export function contentSimilarity(a: string, b: string): number {
  const tokenize = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length > 2),
    );
  const left = tokenize(a);
  const right = tokenize(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  const union = new Set([...left, ...right]).size;
  return union === 0 ? 0 : intersection / union;
}

export const DUPLICATE_SIMILARITY_THRESHOLD = 0.82;

export function computeNovelty(content: string, existing: string[] = []): number {
  if (existing.length === 0) return 1;
  let highest = 0;
  for (const candidate of existing) {
    const similarity = contentSimilarity(content, candidate);
    if (similarity > highest) highest = similarity;
    if (highest >= 0.999) break;
  }
  return 1 - highest;
}

function sourceReliabilityFor(speaker?: string, source?: string): number {
  if (speaker === "user") return 0.95;
  if (source?.startsWith("neural-engine:")) return 0.5;
  if (speaker === "tool") return 0.8;
  if (speaker === "system") return 0.7;
  return 0.6; // agent assertion
}

const MIN_CONTENT_CHARS = 12;
const MAX_CONTENT_CHARS = 2000;

/**
 * Decide what, if anything, to remember.
 *
 * Ordering is deliberate: hard exclusions first (secrets, triviality,
 * duplicates) so that nothing can be reasoned into storage past them, then
 * lane classification, then a value check that can still discard.
 */
export function classifyForIngestion(input: IngestionInput): IngestionVerdict {
  const content = input.content.replace(/\s+/g, " ").trim();
  const reasons: string[] = [];

  const sensitivity = matchesAny(content, SECRET_PATTERNS) ? 1 : 0;
  const novelty = computeNovelty(content, input.existingContents);
  const sourceReliability = sourceReliabilityFor(input.speaker, input.source);
  const temporalRelevance = matchesAny(content, EPHEMERAL_PATTERNS) ? 0.2 : 0.8;

  const discard = (reason: string, signals: Partial<IngestionSignals> = {}): IngestionVerdict => {
    reasons.push(reason);
    return {
      decision: "DISCARD",
      lane: null,
      reasons,
      signals: {
        futureUsefulness: 0,
        novelty,
        confidence: 0.9,
        sourceReliability,
        temporalRelevance,
        sensitivity,
        ...signals,
      },
      expectedRetrievalValue: 0,
      needsModelReview: false,
      suggestedScope: "session",
      suggestedImportance: 0,
    };
  };

  // --- Hard exclusions ---------------------------------------------------
  if (sensitivity === 1) return discard("Contains secret-shaped content; never persisted.");
  if (content.length < MIN_CONTENT_CHARS) return discard("Too short to carry reusable meaning.");
  if (matchesAny(content, TRANSIENT_PATTERNS)) return discard("Transient conversational filler.");
  if (novelty < 1 - DUPLICATE_SIMILARITY_THRESHOLD) {
    return discard(`Duplicate of existing memory (novelty ${novelty.toFixed(2)}).`);
  }

  // --- Lane classification ----------------------------------------------
  let lane: MemoryLane;
  let futureUsefulness: number;
  let confidence: number;

  if (matchesAny(content, PREFERENCE_PATTERNS)) {
    lane = "PREFERENCE";
    futureUsefulness = 0.9;
    confidence = 0.8;
    reasons.push("States a durable preference or standing instruction.");
  } else if (matchesAny(content, PROCEDURAL_PATTERNS)) {
    lane = "PROCEDURAL";
    futureUsefulness = 0.85;
    confidence = 0.7;
    reasons.push("Describes a reusable procedure, sequence or fix.");
  } else if (matchesAny(content, ENTITY_RELATION_PATTERNS)) {
    lane = "ENTITY_RELATION";
    futureUsefulness = 0.8;
    confidence = 0.7;
    reasons.push("Asserts a relationship between entities.");
  } else if (matchesAny(content, SEMANTIC_PATTERNS) && temporalRelevance > 0.5) {
    lane = "SEMANTIC";
    futureUsefulness = 0.7;
    confidence = 0.6;
    reasons.push("Asserts a durable fact about the project or environment.");
  } else {
    lane = "EPISODIC";
    futureUsefulness = 0.4;
    confidence = 0.45;
    reasons.push("Recorded as an event; no durable claim recognised.");
  }

  if (temporalRelevance <= 0.5) reasons.push("Reads as time-bound, so its shelf life is short.");
  if (input.speaker === "user") reasons.push("Asserted by the user, which outranks an agent inference.");
  if (novelty < 0.5) reasons.push(`Partially overlaps existing memory (novelty ${novelty.toFixed(2)}).`);

  // --- Value check -------------------------------------------------------
  const expectedRetrievalValue = Number(
    (
      futureUsefulness * 0.35 +
      novelty * 0.2 +
      sourceReliability * 0.2 +
      temporalRelevance * 0.15 +
      confidence * 0.1
    ).toFixed(4),
  );

  // Episodic material is the bulk of any conversation. Keeping all of it is
  // how a memory system drowns, so low-value episodes are dropped here rather
  // than left for the decay sweep to deal with after they have already cost
  // storage, retrieval slots and prompt tokens.
  const MIN_EPISODIC_VALUE = 0.55;
  if (lane === "EPISODIC" && expectedRetrievalValue < MIN_EPISODIC_VALUE) {
    return discard(
      `Episodic and below the retrieval-value floor (${expectedRetrievalValue.toFixed(2)} < ${MIN_EPISODIC_VALUE}).`,
      { futureUsefulness, confidence },
    );
  }

  if (content.length > MAX_CONTENT_CHARS) {
    reasons.push("Long content; stored truncated to keep retrieval cost bounded.");
  }

  // Cases the rules place in a lane but without much conviction are the ones
  // a cheap classifier would genuinely add value on. Flagged, not faked.
  const needsModelReview = confidence < 0.6 || (lane === "EPISODIC" && expectedRetrievalValue < 0.7);

  const suggestedScope =
    lane === "PREFERENCE" ? "user" : input.projectId ? "project" : "user";

  return {
    decision: lane,
    lane,
    reasons,
    signals: { futureUsefulness, novelty, confidence, sourceReliability, temporalRelevance, sensitivity },
    expectedRetrievalValue,
    needsModelReview,
    suggestedScope,
    suggestedImportance: Number(Math.min(1, Math.max(0.1, expectedRetrievalValue)).toFixed(4)),
  };
}

/** Map a lane onto the existing Memory.type vocabulary. */
export function memoryTypeForLane(lane: MemoryLane): string {
  switch (lane) {
    case "PREFERENCE":
      return "preference";
    case "PROCEDURAL":
      return "skill";
    case "ENTITY_RELATION":
      return "relationship";
    case "SEMANTIC":
      return "fact";
    case "EPISODIC":
      return "event";
  }
}
