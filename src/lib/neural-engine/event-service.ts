// Sentinel Neural Engine — Event service
//
// Thin wrapper over the existing append-only `KnowledgeEvent` log
// (src/lib/knowledge/events.ts). Phase A does not introduce a second event
// table — new event names are additive entries in KnowledgeEventType
// (src/lib/knowledge/types.ts). This is also the seam Phase D's SSE stream
// will read from.

import { emitEvent, getRecentEvents } from "@/lib/knowledge/events";
import type { KnowledgeEventType } from "@/lib/knowledge/types";

export interface NeuralEventParams {
  type: KnowledgeEventType;
  payload: Record<string, unknown>;
  projectId?: string | null;
  workspaceId?: string | null;
}

export async function emitNeuralEvent(params: NeuralEventParams): Promise<void> {
  await emitEvent({
    type: params.type,
    payload: params.payload,
    projectId: params.projectId ?? undefined,
    workspaceId: params.workspaceId ?? undefined,
  });
}

export async function getRecentNeuralEvents(filter: {
  projectId?: string;
  limit?: number;
}) {
  return getRecentEvents(filter);
}
