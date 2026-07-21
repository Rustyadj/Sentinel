// Knowledge Engine — post-response extraction candidates

import Anthropic from "@anthropic-ai/sdk";
import { createKnowledgeObject } from "./objects";
import { emitEvent } from "./events";
import type {
  ExtractionCandidate,
  KnowledgeNode,
  KnowledgeObjectType,
  KnowledgeScope,
} from "./types";

// Generate extraction candidates from a completed conversation turn.
// Falls back to mock candidates only if no key is available anywhere or parsing fails.
export async function extractCandidates(params: {
  messages: Array<{ role: string; content: string }>;
  roomId?: string;
  projectId?: string;
  anthropicKey?: string;
}): Promise<ExtractionCandidate[]> {
  if (!params.anthropicKey) {
    return getMockCandidates(params.roomId);
  }

  try {
    const client = new Anthropic({ apiKey: params.anthropicKey });

    const recentMessages = params.messages.slice(-6);
    const conversationText = recentMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const response = await client.messages.create({
      model: "claude-3-haiku-20240307",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Extract knowledge candidates from this conversation. Return a JSON array only (no markdown, no explanation).

Each item must have:
- candidateType: one of "memory", "decision", "task", "entity", "link"
- title: short label (max 80 chars)
- summary: 1-2 sentence description
- confidence: number 0-1

Conversation:
${conversationText}

Return JSON array only.`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      return getMockCandidates(params.roomId);
    }

    let parsed: unknown;
    try {
      // Strip markdown code fences if present
      const raw = textBlock.text.trim().replace(/^```json?\s*/i, "").replace(/```\s*$/, "");
      parsed = JSON.parse(raw);
    } catch {
      return getMockCandidates(params.roomId);
    }

    if (!Array.isArray(parsed)) return getMockCandidates(params.roomId);

    const candidates: ExtractionCandidate[] = parsed
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      )
      .map((item, idx) => ({
        id: `candidate-${Date.now()}-${idx}`,
        candidateType: (item.candidateType as ExtractionCandidate["candidateType"]) ?? "memory",
        title: String(item.title ?? "Untitled"),
        summary: String(item.summary ?? ""),
        confidence: typeof item.confidence === "number" ? item.confidence : 0.5,
        sourceRoomId: params.roomId,
        sourceMessageIds: [],
        metadata: {},
      }));

    return candidates;
  } catch (err) {
    // Graceful fallback — extraction failures should never break chat
    console.error("extractCandidates error:", err);
    return getMockCandidates(params.roomId);
  }
}

function getMockCandidates(roomId?: string): ExtractionCandidate[] {
  return [
    {
      id: `mock-candidate-1-${Date.now()}`,
      candidateType: "memory",
      title: "Sample memory from conversation",
      summary: "A memory extracted from this conversation (mock — add Anthropic key for real extraction).",
      confidence: 0.3,
      sourceRoomId: roomId,
      sourceMessageIds: [],
      metadata: { mock: true },
    },
    {
      id: `mock-candidate-2-${Date.now()}`,
      candidateType: "task",
      title: "Potential follow-up task",
      summary: "A task candidate identified in the conversation (mock).",
      confidence: 0.25,
      sourceRoomId: roomId,
      sourceMessageIds: [],
      metadata: { mock: true },
    },
    {
      id: `mock-candidate-3-${Date.now()}`,
      candidateType: "decision",
      title: "Decision point noted",
      summary: "A decision candidate from the conversation (mock).",
      confidence: 0.2,
      sourceRoomId: roomId,
      sourceMessageIds: [],
      metadata: { mock: true },
    },
  ];
}

function candidateTypeToObjectType(
  candidateType: ExtractionCandidate["candidateType"]
): KnowledgeObjectType {
  switch (candidateType) {
    case "memory":
      return "Memory";
    case "decision":
      return "Decision";
    case "task":
      return "Task";
    case "entity":
      return "Person"; // generic entity default
    case "link":
      return "Note";
    default:
      return "Note";
  }
}

// Accept a candidate — creates KnowledgeObject + KnowledgeEvent
export async function acceptCandidate(
  candidate: ExtractionCandidate,
  userId: string,
  roomId?: string,
  projectId?: string
): Promise<KnowledgeNode> {
  try {
    const node = await createKnowledgeObject({
      userId,
      type: candidateTypeToObjectType(candidate.candidateType),
      title: candidate.title,
      summary: candidate.summary,
      sourceType: "extraction",
      sourceId: candidate.id,
      scope: (roomId ? "project" : "global") as KnowledgeScope,
      projectId,
      metadata: {
        confidence: candidate.confidence,
        candidateType: candidate.candidateType,
        sourceRoomId: candidate.sourceRoomId ?? roomId,
        sourceMessageIds: candidate.sourceMessageIds ?? [],
        ...candidate.metadata,
      },
    });

    await emitEvent({
      type: "candidate_accepted",
      payload: {
        candidateId: candidate.id,
        candidateType: candidate.candidateType,
        title: candidate.title,
        knowledgeObjectId: node.id,
      },
      roomId: candidate.sourceRoomId ?? roomId,
    });

    return node;
  } catch (err) {
    throw new Error(
      `acceptCandidate failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// Reject a candidate — emits a rejected event (no DB write)
export async function rejectCandidate(
  candidate: ExtractionCandidate
): Promise<void> {
  try {
    await emitEvent({
      type: "candidate_rejected",
      payload: {
        candidateId: candidate.id,
        candidateType: candidate.candidateType,
        title: candidate.title,
      },
      roomId: candidate.sourceRoomId,
    });
  } catch (err) {
    throw new Error(
      `rejectCandidate failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
