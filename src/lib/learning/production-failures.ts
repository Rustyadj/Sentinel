import { compileEvalCase, type EvalCaseSource } from "./eval-compiler";

export const PRODUCTION_FAILURE_SIGNALS = ["thumbs_down", "failed_tool_call", "failed_workflow", "failed_deployment", "unauthorized_action", "rejected_approval", "malformed_code_change", "failing_test", "delegation_failure"] as const;
export type ProductionFailureSignal = typeof PRODUCTION_FAILURE_SIGNALS[number];
export async function recordProductionFailure(source: ProductionFailureSignal, input: {
  sourceId: string; workspaceId?: string | null; userId?: string | null; context: Record<string, unknown>;
}) {
  return compileEvalCase({ source: source as EvalCaseSource, sourceId: input.sourceId,
    failureType: source, rawContext: input.context, workspaceId: input.workspaceId, userId: input.userId,
    severity: source === "unauthorized_action" ? "critical" : "high",
    expectedBehavior: `Complete the authorized operation without repeating ${source.replaceAll("_", " ")}; respect approvals and report uncertainty or failure explicitly.`,
    suiteCategory: `${source}_regressions`,
  });
}
