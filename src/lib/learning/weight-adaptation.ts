// Weight Adaptation Provider boundary.
//
// EXPERIMENTAL. DISABLED BY DEFAULT. HUMAN APPROVAL REQUIRED.
//
// No code path in this repository — production or otherwise — reaches model
// weight training. This file defines the future interface boundary only, so
// a real provider can be plugged in later without redesigning call sites,
// but nothing currently calls getWeightAdaptationProvider() or
// requestWeightAdaptation(), and both throw unconditionally today. Current
// self-improvement operates entirely through prompts, retrieval, memory,
// procedures, workflows, routing, tools, skills, policies, and context
// construction — never model weights.
//
// Flipping WEIGHT_ADAPTATION_ENABLED to true, and registering a real
// provider, is a deliberate future change requiring explicit human sign-off
// — not something this codebase should ever do as a side effect of normal
// operation.

export const WEIGHT_ADAPTATION_ENABLED = false as boolean;

export type WeightAdaptationMethod = "lora" | "full_finetune" | "rlhf";

export interface WeightAdaptationRequest {
  modelId: string;
  datasetRef: string;
  method: WeightAdaptationMethod;
  humanApproverId: string;
  reason: string;
}

export interface WeightAdaptationResult {
  status: "not_implemented";
  modelId: string;
}

export interface WeightAdaptationProvider {
  readonly name: string;
  readonly experimental: true;
  adapt(request: WeightAdaptationRequest): Promise<WeightAdaptationResult>;
}

/**
 * No implementation is registered — intentionally. Always throws.
 */
export function getWeightAdaptationProvider(): WeightAdaptationProvider {
  throw new Error(
    "Weight adaptation is EXPERIMENTAL and DISABLED BY DEFAULT. No provider is registered. " +
      "Implementing one requires explicit human approval and flipping WEIGHT_ADAPTATION_ENABLED " +
      "— see docs/LEARNING_CORE_EVOLUTION.md.",
  );
}

/**
 * Always rejects while WEIGHT_ADAPTATION_ENABLED is false (its only
 * supported value in this codebase today). Exists so a future caller has a
 * stable function signature to build against, not because anything calls it.
 */
export async function requestWeightAdaptation(request: WeightAdaptationRequest): Promise<WeightAdaptationResult> {
  if (!WEIGHT_ADAPTATION_ENABLED) {
    throw new Error(
      `Weight adaptation is disabled — request for model "${request.modelId}" via "${request.method}" was not executed. ` +
        "Current improvement operates through prompts/retrieval/memory/procedures/workflows/routing/tools/skills/policies/context — never weights.",
    );
  }
  return getWeightAdaptationProvider().adapt(request);
}
