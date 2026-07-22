// Sentinel Neural Engine — Knowledge service facade
//
// Deliberately thin: Layer 1 (Canonical Knowledge Graph) is already real and
// working in src/lib/knowledge/* (see docs/neural-engine/PHASE_A_CONFLICTS.md).
// This file re-exports it under the neural-engine namespace so consumers of
// the Neural Engine have one import surface, without forking the
// implementation.

export {
  createKnowledgeObject,
  getKnowledgeObject,
  listKnowledgeObjects,
  bridgeMemory,
  bridgeAgent,
  bridgeChatRoom,
} from "@/lib/knowledge/objects";

export { createEdge, upsertEdge, listEdges, deleteEdge } from "@/lib/knowledge/edges";

export {
  createDecision,
  approveDecision,
  rejectDecision,
  supersedeDecision,
} from "@/lib/knowledge/decisions";

export { buildGraphData } from "@/lib/knowledge/graph";

export { retrieveContext } from "@/lib/knowledge/retrieval";

export type {
  KnowledgeNode,
  KnowledgeEdge as KnowledgeEdgeDTO,
  KnowledgeObjectType,
  KnowledgeEdgeType,
  KnowledgeScope,
  DecisionRecord,
  DecisionStatus,
  RetrievalContext,
} from "@/lib/knowledge/types";

// Net-new Phase A surfaces layer on top of the above:
export * from "./temporal-service";
