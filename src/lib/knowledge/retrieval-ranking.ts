import type { TemporalIntent } from "./temporal-intent";
// Sentinel — query-aware ranking for scoped memory retrieval.
//
// Why this exists: until now `retrieveContext` never saw the query. It
// returned the top-N memories in scope ordered by (pinned, valueScore,
// importanceScore, createdAt), so every question asked in the same scope got
// the same answer. The memory benchmark measured 32 cases and observed four
// distinct result sets -- one per scope context -- with Recall@10 0.200 and
// 95.7% of retrieved memories irrelevant to the question asked.
//
// This module does not fetch anything and does not decide what is visible.
// Scope and governance filtering stay exactly where they were, in
// buildRetrievalFilters() and memory-governance. This only orders and trims a
// candidate set that the caller has already proven the user may see.
//
// Every score carries its factors, so "why was this retrieved, and why did it
// outrank that one" is answerable from the returned value rather than
// reconstructed by guesswork.

export interface RankableMemory {
  id: string;
  content: string;
  scope: string;
  tags: string[];
  pinned: boolean;
  confidence: number | null;
  importanceScore: number | null;
  valueScore: number | null;
  createdAt: Date;
  /** Set when this memory has been superseded. Only ever populated for
   *  historical queries — a current-truth query never fetches these rows. */
  validTo?: Date | null;
}

export interface RankingFactor {
  name: string;
  weight: number;
  score: number;
  detail?: string;
}

export interface RankedMemory<T extends RankableMemory = RankableMemory> {
  memory: T;
  score: number;
  factors: RankingFactor[];
}

export const RANKING_WEIGHTS = {
  lexical_coverage: 3.0,
  rare_term: 2.0,
  tag_match: 1.0,
  value: 0.8,
  historical_fit: 1.2,
  importance: 0.5,
  confidence: 0.4,
  recency: 0.6,
  scope_specificity: 0.5,
  pinned: 1.5,
} as const;

const STOP_WORDS = new Set([
  "a","an","and","are","as","at","be","but","by","can","did","do","does","for","from","get","give","has","have","how",
  "i","in","is","it","its","me","my","of","on","or","our","should","show","tell","that","the","their","them","then",
  "there","these","this","to","use","used","uses","using","was","we","what","when","where","which","who","why","will",
  "with","you","your","about","into","run","runs","does","doing","am","allowed","assume","current","currently","give",
]);

/**
 * Conservative suffix normalisation.
 *
 * Not a full stemmer -- deliberately. It collapses the inflections that
 * actually cost recall in practice ("prefers"/"prefer", "deployed"/"deploy",
 * "migrations"/"migration") and leaves everything else alone. Identifier-like
 * tokens (SNTL-4471, text-embedding-3-small, icfops.example) are never
 * touched, because mangling them destroys exactly the rare-term signal that
 * makes exact retrieval work.
 */
export function normalizeToken(token: string): string {
  if (/[0-9._-]/.test(token)) return token;
  if (token.length <= 4) return token;
  for (const [suffix, minLength] of [["ies", 5], ["sses", 6], ["ing", 6], ["ed", 5], ["es", 5], ["s", 4]] as const) {
    if (token.endsWith(suffix) && token.length > minLength) {
      return suffix === "ies" ? `${token.slice(0, -3)}y` : token.slice(0, -suffix.length);
    }
  }
  return token;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) ?? [])
    // "." and "-" are kept inside a token so identifiers survive whole
    // ("icfops.example", "claude-3-opus", "text-embedding-3-small"). The cost
    // is that the match also swallows the punctuation that ends a sentence, so
    // "stores embeddings." tokenised to "embeddings." and could never match a
    // query's "embeddings". Trailing punctuation is therefore trimmed; an
    // identifier mid-sentence is untouched, and one at the end of a sentence
    // now tokenises the same way it does anywhere else.
    .map((token) => token.replace(/[._-]+$/, ""))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token))
    .map(normalizeToken)
    .filter((token) => !STOP_WORDS.has(token));
}

/** A token nobody else uses is worth far more than one everybody uses. This is
 *  the idf half of tf-idf, computed over the candidate set rather than a
 *  corpus -- the candidate set *is* the corpus at retrieval time. */
function inverseDocumentFrequency(candidates: string[][], token: string): number {
  const containing = candidates.filter((tokens) => tokens.includes(token)).length;
  return Math.log((candidates.length + 1) / (containing + 1)) + 1;
}

/** Newer is better, but gently: a 14-day half-life, so a genuinely relevant
 *  six-week-old fact still beats an irrelevant one from this morning. */
function recencyScore(createdAt: Date, now: number): number {
  const ageDays = Math.max(0, (now - createdAt.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / 14);
}

/** A project-scoped memory retrieved from inside that project is more
 *  specifically addressed to the question than a global convention. */
function scopeSpecificity(scope: string): number {
  switch (scope) {
    case "session": return 1.0;
    case "project": return 0.9;
    case "workspace": return 0.7;
    case "organization": return 0.6;
    case "user": return 0.5;
    default: return 0.3;
  }
}

export interface RankOptions {
  /** Keep at most this many. */
  limit: number;
  /** Drop anything scoring below this fraction of the best score. This is what
   *  stops a bounded context budget being filled with near-zero matches just
   *  because there was room. */
  relativeFloor?: number;
  now?: number;
  /**
   * What the question asks about in time.
   *
   * Only "historical" / "as_of" change anything here, and only then because
   * the candidate set is different: scope filtering has already let superseded
   * rows through, and without this they would be ranked *below* the belief
   * that replaced them by recency and value — so the question "what did we use
   * before?" would still be answered with the current value. On a current
   * query no superseded row is present, so this factor is inert rather than
   * merely unused.
   */
  temporalIntent?: TemporalIntent;
  /** For "as_of": the point the world is being asked about. */
  asOf?: Date | null;
}

/**
 * Rank candidates against a query.
 *
 * An empty query returns the candidates untouched: callers that have no query
 * (background sweeps, whole-scope exports) must keep their existing
 * value-ordered behaviour rather than be silently re-sorted by a lexical
 * signal computed from nothing.
 */
/**
 * How well this memory answers a question about the past.
 *
 * Zero for a current-truth question, so ranking behaves exactly as it did.
 * For a look-back, a superseded belief is what was asked for and the belief
 * that replaced it is not; for an as-of question, the memory must actually
 * have been valid at that point.
 */
function historicalFit(
  memory: { validFrom?: Date; validTo?: Date | null; createdAt: Date },
  options: RankOptions,
): number {
  const intent = options.temporalIntent ?? "current";
  if (intent === "current") return 0;
  const superseded = memory.validTo != null;
  if (intent === "historical") return superseded ? 1 : 0;

  // as_of: valid at the stated point, superseded-or-not.
  const asOf = options.asOf;
  if (!asOf) return superseded ? 0.5 : 0;
  const startedBefore = (memory.validFrom ?? memory.createdAt) <= asOf;
  const stillValid = memory.validTo == null || memory.validTo > asOf;
  return startedBefore && stillValid ? 1 : 0;
}

export function rankMemories<T extends RankableMemory>(
  query: string,
  candidates: T[],
  options: RankOptions,
): RankedMemory<T>[] {
  const queryTokens = [...new Set(tokenize(query))];
  const now = options.now ?? Date.now();

  if (queryTokens.length === 0) {
    return candidates.slice(0, options.limit).map((memory) => ({
      memory,
      score: 0,
      factors: [{ name: "no_query", weight: 0, score: 0, detail: "ranking skipped; caller supplied no query" }],
    }));
  }

  const tokenizedCandidates = candidates.map((memory) => tokenize(`${memory.content} ${memory.tags.join(" ")}`));
  const idf = new Map(queryTokens.map((token) => [token, inverseDocumentFrequency(tokenizedCandidates, token)]));
  const maxIdf = Math.max(...idf.values(), 1);

  const ranked = candidates.map((memory, index) => {
    const tokens = new Set(tokenizedCandidates[index]);
    const tagTokens = new Set(tokenize(memory.tags.join(" ")));
    const matched = queryTokens.filter((token) => tokens.has(token));

    // Coverage: what share of the question this memory speaks to.
    const coverage = matched.length / queryTokens.length;

    // Rare-term: did it match the *distinctive* words. "SNTL-4471" matching is
    // worth more than "sentinel" matching in a corpus about Sentinel.
    const rare =
      matched.length === 0
        ? 0
        : Math.max(...matched.map((token) => idf.get(token) ?? 1)) / maxIdf;

    const tagHit = queryTokens.some((token) => tagTokens.has(token)) ? 1 : 0;

    const factors: RankingFactor[] = [
      {
        name: "lexical_coverage",
        weight: RANKING_WEIGHTS.lexical_coverage,
        score: coverage,
        detail: matched.length ? `matched ${matched.join(", ")}` : "no query terms matched",
      },
      { name: "rare_term", weight: RANKING_WEIGHTS.rare_term, score: rare },
      { name: "tag_match", weight: RANKING_WEIGHTS.tag_match, score: tagHit },
      { name: "value", weight: RANKING_WEIGHTS.value, score: memory.valueScore ?? 0.5 },
      { name: "importance", weight: RANKING_WEIGHTS.importance, score: memory.importanceScore ?? 0.5 },
      { name: "confidence", weight: RANKING_WEIGHTS.confidence, score: memory.confidence ?? 0.5 },
      { name: "recency", weight: RANKING_WEIGHTS.recency, score: recencyScore(memory.createdAt, now) },
      { name: "scope_specificity", weight: RANKING_WEIGHTS.scope_specificity, score: scopeSpecificity(memory.scope) },
      { name: "pinned", weight: RANKING_WEIGHTS.pinned, score: memory.pinned ? 1 : 0 },
      {
        name: "historical_fit",
        weight: RANKING_WEIGHTS.historical_fit,
        score: historicalFit(memory, options),
        detail: options.temporalIntent && options.temporalIntent !== "current"
          ? `temporal intent ${options.temporalIntent}`
          : undefined,
      },
    ];

    return { memory, score: factors.reduce((sum, factor) => sum + factor.weight * factor.score, 0), factors };
  });

  // A memory that matches nothing in the question is not a weak match, it is a
  // non-match. Without this the budget is filled by whatever ranks highest on
  // recency and value alone -- which is precisely the behaviour being replaced.
  const relevant = ranked.filter((entry) => {
    const coverage = entry.factors.find((factor) => factor.name === "lexical_coverage")?.score ?? 0;
    return coverage > 0;
  });

  const pool = relevant.length > 0 ? relevant : [];
  pool.sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id));

  const floor = options.relativeFloor ?? 0.45;
  const best = pool[0]?.score ?? 0;
  return pool.filter((entry) => entry.score >= best * floor).slice(0, options.limit);
}
