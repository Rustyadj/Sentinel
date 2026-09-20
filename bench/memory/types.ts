// Sentinel memory benchmark — shared types.
//
// The benchmark exists to answer one question that no amount of new code can
// answer on its own: does Sentinel actually retrieve the right memory for a
// given query, in the right scope, in the right order?
//
// Everything here describes a *fixture world* (users, workspaces, projects,
// memories) plus a set of cases that query it through the real production
// retrieval path. No case may reach into internals; if a signal is not
// observable through the path a real agent uses, it is not measured.

/** The 25 capabilities the benchmark is required to cover. */
export type BenchCategory =
  | "factual_recall"
  | "cross_session_recall"
  | "project_recall"
  | "workspace_recall"
  | "preference_recall"
  | "episodic_recall"
  | "temporal_ordering"
  | "entity_relationships"
  | "semantic_similarity"
  | "lexical_retrieval"
  | "corrections"
  | "contradictions"
  | "supersession"
  | "stale_information"
  | "irrelevant_rejection"
  | "false_memory_rejection"
  | "project_isolation"
  | "workspace_isolation"
  | "user_isolation"
  | "cross_project_leakage"
  | "procedural_memory"
  | "long_running_accumulation"
  | "duplicate_memories"
  | "ambiguous_memories"
  | "conflicting_memories";

/** A memory row to seed. Ids are stable and human-readable so a failing case
 *  names the exact memory that was or wasn't retrieved. */
export interface BenchMemory {
  id: string;
  content: string;
  /** session | project | workspace | organization | user | global */
  scope: string;
  /** Memory.owner — the userId that owns the row. */
  owner: string;
  type: string;
  source: string;
  tags?: string[];
  projectId?: string | null;
  /** Memory.workspaceId. Required for scope = "workspace": since migration
   *  20260920160000 a workspace-scoped memory without one is unresolved, and
   *  unresolved is unreachable. */
  workspaceId?: string | null;
  confidence?: number;
  importanceScore?: number;
  valueScore?: number | null;
  pinned?: boolean;
  archived?: boolean;
  state?: string;
  provenanceClass?: string;
  /** Days before "now". Positive = older. Drives recency and temporal cases. */
  ageDays?: number;
  /** Days before "now" that the described event happened — Memory.eventTime.
   *  Deliberately independent of ageDays so ordering cannot pass by reading
   *  insertion order. */
  eventAgeDays?: number | null;
  supersededById?: string | null;
  validTo?: number | null;
}

export interface BenchWorld {
  users: Array<{ id: string; email: string; name: string }>;
  workspaces: Array<{ id: string; slug: string; name: string; ownerId: string }>;
  projects: Array<{ id: string; name: string; userId: string; workspaceId: string }>;
  memories: BenchMemory[];
}

export interface BenchCase {
  id: string;
  categories: BenchCategory[];
  /** What the agent is asking about. */
  query: string;
  /** The retrieval context a real caller would pass. */
  ctx: {
    userId: string;
    projectId?: string;
    workspaceId?: string;
    organizationId?: string;
    scopePolicy?: "isolated" | "user-context";
    maxItems?: number;
  };
  /** Memories that SHOULD be retrieved. Recall/precision/MRR are computed
   *  against this set. */
  relevant: string[];
  /** Memories that MUST NOT be retrieved. A hit here is a hard failure —
   *  leakage, a superseded fact, a stale fact, or an outright false memory.
   *  `forbiddenReason` classifies which kind, so the report can separate
   *  "wrong answer" from "isolation breach". */
  forbidden?: string[];
  forbiddenReason?: "leakage" | "stale" | "superseded" | "false" | "irrelevant";
  /** For temporal_ordering: the expected relative order of these ids in the
   *  retrieved list. Only the listed ids are checked, and only pairwise. */
  expectedOrder?: string[];
  notes?: string;
}

/** Per-case measurement. Every number here is derived from the real retrieval
 *  result, never from a mock. */
export interface CaseResult {
  caseId: string;
  categories: BenchCategory[];
  retrievedIds: string[];
  injectedIds: string[];
  recallAtK: Record<string, number>;
  precisionAtK: Record<string, number>;
  reciprocalRank: number;
  /** Forbidden ids that were retrieved. */
  forbiddenRetrieved: string[];
  forbiddenReason: BenchCase["forbiddenReason"] | null;
  /** Retrieved ids that are neither relevant nor forbidden. */
  irrelevantRetrieved: number;
  irrelevantRate: number;
  orderCorrect: boolean | null;
  contextTokens: number;
  retrievalLatencyMs: number;
  embeddingLatencyMs: number;
  rerankLatencyMs: number;
  error?: string;
}

export interface BenchRunMeta {
  label: string;
  commit: string;
  branch: string;
  startedAt: string;
  finishedAt: string;
  nodeVersion: string;
  databaseUrlHost: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimensions: number | null;
  kValues: number[];
  caseCount: number;
  memoryCount: number;
}

export interface BenchReport {
  meta: BenchRunMeta;
  overall: AggregateMetrics;
  byCategory: Record<string, AggregateMetrics>;
  cases: CaseResult[];
}

export interface AggregateMetrics {
  cases: number;
  recallAtK: Record<string, number>;
  precisionAtK: Record<string, number>;
  mrr: number;
  /** Share of cases where any forbidden memory was retrieved. */
  falseRetrievalRate: number;
  /** Share of cases where a scope-isolation forbidden memory was retrieved. */
  scopeLeakageRate: number;
  irrelevantRetrievalRate: number;
  temporalAccuracy: number | null;
  meanContextTokens: number;
  meanRetrievalLatencyMs: number;
  p95RetrievalLatencyMs: number;
  meanEmbeddingLatencyMs: number;
  meanRerankLatencyMs: number;
  errors: number;
}
