import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { syncEvolutionEventToGraph } from "./graph";

export const EVOLUTION_STAGES = [
  "created",
  "testing",
  "shadow",
  "approved",
  "production",
  "rollback",
  "superseded",
] as const;

export type EvolutionStage = (typeof EVOLUTION_STAGES)[number];

export async function appendEvolutionEvent(input: {
  title: string;
  stage: EvolutionStage;
  relatedType?: string;
  relatedId?: string;
  metadata?: Record<string, unknown>;
}) {
  const event = await db.evolutionEvent.create({
    data: {
      title: input.title,
      stage: input.stage,
      relatedType: input.relatedType ?? null,
      relatedId: input.relatedId ?? null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
  await syncEvolutionEventToGraph(event);
  return event;
}

export async function listEvolutionEvents(params?: {
  stage?: string;
  relatedType?: string;
  relatedId?: string;
  limit?: number;
}) {
  return db.evolutionEvent.findMany({
    where: {
      ...(params?.stage ? { stage: params.stage } : {}),
      ...(params?.relatedType ? { relatedType: params.relatedType } : {}),
      ...(params?.relatedId ? { relatedId: params.relatedId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 200,
  });
}

export function lifecycleStageFor(type: "hypothesis" | "experiment" | "skill", status: string): EvolutionStage {
  const stages: Record<string, EvolutionStage> = {
    "hypothesis:draft": "created",
    "hypothesis:testing": "testing",
    "hypothesis:validated": "approved",
    "hypothesis:rejected": "superseded",
    "experiment:shadow": "shadow",
    "experiment:running": "testing",
    "experiment:completed": "approved",
    "experiment:promoted": "production",
    "experiment:discarded": "rollback",
    "skill:proposed": "created",
    "skill:testing": "testing",
    "skill:approved": "approved",
    "skill:installed": "production",
    "skill:deprecated": "superseded",
  };
  return stages[`${type}:${status}`] ?? "created";
}
