// Sentinel Neural Engine — Retrieval Planner (Layer 6)
//
// PHASE C, NOT PHASE A. This file exists so the module's directory shape is
// stable for callers/imports written against the planned structure, but the
// actual multi-factor ranking (semantic similarity + graph proximity + scope
// + recency + confidence + importance + provenance quality + prior success/
// failure + agent competency + task type + explicit user selection) is not
// implemented here.
//
// What Phase A ships instead: src/lib/knowledge/retrieval.ts — a real,
// working, single-factor (scope + pin + importance + recency) retriever with
// enforced project isolation. Route retrieval needs through that today.
//
// Do not fake ranking logic here. An honest NotImplementedYet beats a planner
// that silently ignores half its inputs.

import type { RetrievalContext } from "@/lib/knowledge/types";

export interface RetrievalRequest extends RetrievalContext {
  query: string;
  taskType?: string;
  explicitObjectIds?: string[];
}

export interface RetrievalRankingFactor {
  factor:
    | "semantic_similarity"
    | "graph_proximity"
    | "scope"
    | "recency"
    | "confidence"
    | "importance"
    | "provenance_quality"
    | "prior_success"
    | "prior_failure"
    | "agent_competency"
    | "task_type"
    | "explicit_selection";
  weight: number;
  score: number;
}

export interface RetrievalResultItem {
  objectId: string;
  finalScore: number;
  factors: RetrievalRankingFactor[];
}

/** Provenance trace only — never chain-of-thought. */
export interface RetrievalTrace {
  requestId: string;
  scope: string;
  sourceObjectIds: string[];
  relationshipPaths: Array<{ from: string; to: string; via: string[] }>;
  rankingFactors: RetrievalRankingFactor[];
  confidence: number;
}

export interface RetrievalPlan {
  request: RetrievalRequest;
  candidateObjectIds: string[];
}

export interface RetrievalResult {
  items: RetrievalResultItem[];
  trace: RetrievalTrace;
}

export class NotImplementedYet extends Error {
  constructor(fn: string) {
    super(
      `retrieval-planner.${fn} is Phase C scope, not implemented in Phase A. ` +
        `Use retrieveContext() from src/lib/knowledge/retrieval.ts (re-exported ` +
        `via neural-engine/knowledge-service.ts) for scoped retrieval today.`,
    );
    this.name = "NotImplementedYet";
  }
}

export function planRetrieval(request: RetrievalRequest): RetrievalPlan {
  void request;
  throw new NotImplementedYet("planRetrieval");
}

export function executeRetrievalPlan(plan: RetrievalPlan): Promise<RetrievalResult> {
  void plan;
  throw new NotImplementedYet("executeRetrievalPlan");
}
