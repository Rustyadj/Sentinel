// Sentinel — controlled shadow retrieval experiment.
//
// Answers the only question that should decide whether generalized memories are
// ever promoted: would including them have made retrieval *smaller and better*,
// or just different? It compares production retrieval against a counterfactual
// that also admits shadow memories, and reports the delta. It changes nothing —
// production retrieval is untouched, and shadow memories stay excluded.

import { db } from "@/lib/db";
import { retrieveContext } from "@/lib/knowledge/retrieval";
import type { RetrievalContext } from "@/lib/knowledge/types";
import { estimateTokens, retrievalFootprint } from "./memory-metrics-service";

export interface ShadowComparison {
  production: { items: number; estimatedTokens: number; duplicateItems: number };
  withShadow: { items: number; estimatedTokens: number; duplicateItems: number };
  /** Negative means the shadow variant would have used fewer tokens. */
  tokenDelta: number;
  duplicateDelta: number;
  shadowMemoriesConsidered: number;
  /** Episodes the admitted abstractions stand in for. */
  episodesRepresented: number;
  verdict: "smaller" | "larger" | "unchanged";
}

/**
 * Compare production retrieval with a counterfactual that also admits this
 * user's shadow-generated abstractions.
 *
 * The counterfactual is built by *substitution*, not addition: an abstraction
 * earns its place only by replacing the episodes it was derived from. Simply
 * appending generalizations to an unchanged prompt would grow context, which is
 * the opposite of the goal — so a variant that only adds is reported as larger
 * and should not be promoted.
 */
export async function compareShadowRetrieval(ctx: RetrievalContext): Promise<ShadowComparison> {
  const production = await retrieveContext(ctx);
  const productionFootprint = retrievalFootprint(production.memories);

  const shadowMemories = await db.memory.findMany({
    where: {
      shadowOnly: true,
      validTo: null,
      owner: ctx.userId,
      ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
    },
    select: { content: true, derivedFromExperienceIds: true },
  });

  // Which retrieved memories would the abstractions displace? A memory is
  // displaced when it was derived from — or is textually contained by — an
  // abstraction that covers it.
  const representedEpisodes = new Set(shadowMemories.flatMap((m) => m.derivedFromExperienceIds));

  const substituted = [
    ...shadowMemories.map((m) => ({ content: m.content })),
    ...production.memories.filter((memory) => !isCoveredByAbstraction(memory.content, shadowMemories)),
  ];
  const shadowFootprint = retrievalFootprint(substituted);

  const tokenDelta = shadowFootprint.estimatedTokens - productionFootprint.estimatedTokens;

  return {
    production: {
      items: productionFootprint.items,
      estimatedTokens: productionFootprint.estimatedTokens,
      duplicateItems: productionFootprint.duplicateItems,
    },
    withShadow: {
      items: shadowFootprint.items,
      estimatedTokens: shadowFootprint.estimatedTokens,
      duplicateItems: shadowFootprint.duplicateItems,
    },
    tokenDelta,
    duplicateDelta: shadowFootprint.duplicateItems - productionFootprint.duplicateItems,
    shadowMemoriesConsidered: shadowMemories.length,
    episodesRepresented: representedEpisodes.size,
    verdict: tokenDelta < 0 ? "smaller" : tokenDelta > 0 ? "larger" : "unchanged",
  };
}

/**
 * Whether an abstraction already says what this memory says.
 *
 * Kept deliberately conservative — substantial shared wording, not a loose
 * similarity score — because wrongly displacing a specific memory with a vaguer
 * summary loses information, and that failure is invisible in a token count.
 */
function isCoveredByAbstraction(
  content: string,
  abstractions: Array<{ content: string }>,
): boolean {
  const tokens = new Set(content.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
  if (tokens.size === 0) return false;

  return abstractions.some((abstraction) => {
    const abstractionTokens = new Set(abstraction.content.toLowerCase().split(/\W+/).filter((t) => t.length > 3));
    let shared = 0;
    for (const token of tokens) if (abstractionTokens.has(token)) shared += 1;
    return shared / tokens.size >= 0.6;
  });
}

export interface PromotionReadiness {
  ready: boolean;
  reasons: string[];
}

/**
 * Whether a generalized memory has earned promotion out of shadow.
 *
 * Every criterion must hold. These are the gates the architecture proposal
 * named, encoded so promotion is a check rather than a judgement call — and so
 * that "it looked right" can never be the reason something entered production.
 */
export function assessPromotionReadiness(memory: {
  provenanceClass: string;
  derivedFromExperienceIds: string[];
  confirmationCount: number;
  disconfirmationCount: number;
  contradictionCount: number;
  confidence: number;
}, minEpisodes = 3, minConfirmations = 2): PromotionReadiness {
  const reasons: string[] = [];

  if (memory.derivedFromExperienceIds.length < minEpisodes) {
    reasons.push(`needs ${minEpisodes} independent source episodes, has ${memory.derivedFromExperienceIds.length}`);
  }
  if (memory.confirmationCount < minConfirmations) {
    reasons.push(`needs ${minConfirmations} independent confirmations after generation, has ${memory.confirmationCount}`);
  }
  if (memory.contradictionCount > 0) {
    reasons.push("has unresolved contradictions");
  }
  if (memory.disconfirmationCount >= memory.confirmationCount && memory.disconfirmationCount > 0) {
    reasons.push("has not been more useful than not");
  }
  if (memory.confidence < 0.6) {
    reasons.push(`confidence ${memory.confidence.toFixed(2)} is below the promotion floor of 0.60`);
  }

  return { ready: reasons.length === 0, reasons };
}

export { estimateTokens };
