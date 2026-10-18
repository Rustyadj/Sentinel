/** Read-only provider probe. Uses synthetic text; never dispatches an agent. */
import { resolveSystemOneConfig } from "@/lib/system-one/config";
import { JevProvider } from "@/lib/system-one/providers/jev";
import { SystemOneDecisionService } from "@/lib/system-one/service";

async function main() {
  const config = resolveSystemOneConfig();
  if (!config.apiKey) throw new Error("Configure SYSTEM_ONE_API_KEY or TYPESAFE_API_KEY before probing");
  const service = new SystemOneDecisionService(new JevProvider({ ...config, apiKey: config.apiKey }), config);
  let failures = 0;
  for (const agentId of ["hermes-lisa", "hermes-nathan2", "claude-code", "codex"]) {
    const result = await service.decide({ agentId, request: "Review this code and implement a durable queue. Preserve the assigned agent.", surface: "runtime_api", tools: [], configuredModel: "unchanged-by-probe" }, { timeoutMs: config.timeoutMs });
    console.log(JSON.stringify({ probe: "synthetic-provider-only", agentId, providerHost: new URL(config.baseUrl).hostname, configuredModel: config.model,
      actualModel: result.providerModel, outcome: result.outcome, latencyMs: result.latencyMs, inputTokens: result.inputTokens,
      reportedCostUsd: result.costUsd, route: result.decision?.route, intent: result.decision?.intent,
      suggestedModel: result.decision?.suggestedModel, memoryScope: result.decision?.memoryScope }));
    if (result.outcome !== "ok" || result.decision?.route !== "agent_runtime" || result.decision?.suggestedModel !== "unchanged-by-probe") failures++;
  }
  if (failures) process.exitCode = 1;
}
main().catch(() => { console.error("Provider probe failed; credentials and response body suppressed"); process.exitCode = 1; });
