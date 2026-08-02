// Learning Core — Intent Discovery.
//
// Deliberately heuristic, not an LLM call: adding a model round-trip before
// every chat turn would double latency and cost for a signal that only
// needs to be roughly right, since it's stored as provisional evidence
// (confidence-scored), not fact — see docs/LEARNING_CORE_ON_NEURAL_ENGINE.md.
// This is a real, if approximate, v1. It should improve over time, not be
// mistaken for genuine NLU.

export interface IntentAnalysis {
  underlyingGoal: string | null;
  constraints: string[];
  successCriteria: string[];
  confidence: number; // always low-to-medium — heuristic extraction, never "certain"
  evidence: string[]; // which phrases drove the extraction, for auditability
}

const GOAL_MARKERS = [/\bso that\b/i, /\bbecause\b/i, /\bin order to\b/i, /\bfor\b(?!\s*(the|a|an)\b)/i];
const CONSTRAINT_MARKERS = [
  /\bmust\b/i,
  /\bshould not\b|\bshouldn't\b/i,
  /\bdo not\b|\bdon't\b/i,
  /\bnever\b/i,
  /\bonly\b/i,
  /\bbudget\b/i,
  /\bdeadline\b/i,
  /\bwithout\b/i,
];
const SUCCESS_MARKERS = [/\bwhen\b/i, /\buntil\b/i, /\bas long as\b/i, /\bshould (?:be|have|show|result in)\b/i];

function extractSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Confidence climbs a little with more corroborating evidence, but never
// past a ceiling that would let this heuristic be treated as certain.
const BASE_CONFIDENCE = 0.3;
const CONFIDENCE_PER_MARKER = 0.08;
const MAX_CONFIDENCE = 0.55;

export function analyzeIntent(userContent: string): IntentAnalysis {
  const sentences = extractSentences(userContent);
  const evidence: string[] = [];

  let underlyingGoal: string | null = null;
  const constraints: string[] = [];
  const successCriteria: string[] = [];

  for (const sentence of sentences) {
    if (!underlyingGoal && GOAL_MARKERS.some((re) => re.test(sentence))) {
      underlyingGoal = sentence;
      evidence.push(`goal marker in: "${sentence}"`);
    }
    if (CONSTRAINT_MARKERS.some((re) => re.test(sentence))) {
      constraints.push(sentence);
      evidence.push(`constraint marker in: "${sentence}"`);
    }
    if (SUCCESS_MARKERS.some((re) => re.test(sentence))) {
      successCriteria.push(sentence);
      evidence.push(`success-criteria marker in: "${sentence}"`);
    }
  }

  const confidence = Math.min(
    BASE_CONFIDENCE + evidence.length * CONFIDENCE_PER_MARKER,
    MAX_CONFIDENCE
  );

  return {
    underlyingGoal,
    constraints,
    successCriteria,
    confidence: evidence.length > 0 ? confidence : 0,
    evidence,
  };
}
