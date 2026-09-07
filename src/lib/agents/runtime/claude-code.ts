import type { WorkerModelConfig } from "@/lib/agents/model-policy";
import type { ReportedTokenUsage } from "@/lib/agents/pricing";
import { CliRuntimeAdapter } from "./cli-adapter";
import type { RuntimeCapabilities, RuntimeEvent, RuntimeInstance } from "./types";

/**
 * Verified on the VPS mounted Claude Code 2.1.226: --model MODEL --effort LEVEL.
 * Authenticated execution is recorded separately in the acceptance report.
 */
export class ClaudeCodeRuntimeAdapter extends CliRuntimeAdapter {
  readonly kind = "claude-code" as const;
  protected readonly versionArgs = ["--version"];
  protected readonly authArgs = ["auth", "status"];
  protected readonly supportsResume = true;

  protected buildTaskArgs(runtime: RuntimeInstance, prompt: string, externalSessionId?: string, modelConfig?: WorkerModelConfig) {
    return [
      ...(runtime.args ?? []),
      ...(modelConfig ? ["--model", modelConfig.runtimeModelId, ...(modelConfig.effort ? ["--effort", modelConfig.effort] : [])] : []),
      "-p", prompt,
      "--output-format", "stream-json",
      "--verbose",
      ...(externalSessionId ? ["--resume", externalSessionId] : []),
    ];
  }

  protected parseStructuredLine(line: string, sessionId: string): { type: RuntimeEvent["type"]; data: Record<string, unknown>; externalSessionId?: string } {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const externalSessionId = typeof value.session_id === "string" ? value.session_id : undefined;
      if (value.type === "assistant") return { type: "assistant_delta", data: { event: value }, externalSessionId };
      if (value.type === "tool_use") return { type: "tool_started", data: { event: value }, externalSessionId };
      if (value.type === "tool_result") return { type: "tool_completed", data: { event: value }, externalSessionId };
      if (value.type === "result") {
        const tokenUsage = claudeResultTokenUsage(value);
        return { type: "status", data: { event: value, ...(tokenUsage ? { tokenUsage } : {}) }, externalSessionId };
      }
      return { type: "stdout", data: { event: value }, externalSessionId };
    } catch {
      return { type: "stdout", data: { text: line, sessionId } };
    }
  }

  async capabilities(runtime: RuntimeInstance): Promise<RuntimeCapabilities> {
    void runtime;
    return {
      streaming: true,
      resume: true,
      cancel: true,
      toolEvents: true,
      fileChangeEvents: true,
      restart: { supported: false, reason: "runtime_does_not_expose_capability" },
      reload: { supported: false, reason: "runtime_does_not_expose_capability" },
    };
  }
}

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function claudeResultTokenUsage(value: Record<string, unknown>): ReportedTokenUsage | null {
  const usage = value.usage && typeof value.usage === "object" && !Array.isArray(value.usage)
    ? value.usage as Record<string, unknown> : null;
  const cacheCreation = usage?.cache_creation && typeof usage.cache_creation === "object" && !Array.isArray(usage.cache_creation)
    ? usage.cache_creation as Record<string, unknown> : null;
  const inputTokens = tokenCount(usage?.input_tokens);
  const outputTokens = tokenCount(usage?.output_tokens);
  const cachedInputTokens = tokenCount(usage?.cache_read_input_tokens);
  const cacheWriteInputTokens = tokenCount(usage?.cache_creation_input_tokens);
  const cacheWrite5mInputTokens = tokenCount(cacheCreation?.ephemeral_5m_input_tokens);
  const cacheWrite1hInputTokens = tokenCount(cacheCreation?.ephemeral_1h_input_tokens);
  if ([inputTokens, outputTokens, cachedInputTokens, cacheWriteInputTokens, cacheWrite5mInputTokens, cacheWrite1hInputTokens].some((count) => count === null)) return null;
  if (cacheWrite5mInputTokens! + cacheWrite1hInputTokens! !== cacheWriteInputTokens) return null;
  return { inputTokens: inputTokens!, outputTokens: outputTokens!, cachedInputTokens: cachedInputTokens!, cacheWrite5mInputTokens: cacheWrite5mInputTokens!, cacheWrite1hInputTokens: cacheWrite1hInputTokens! };
}
