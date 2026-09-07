import type { WorkerModelConfig } from "@/lib/agents/model-policy";
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
      if (value.type === "result") return { type: "status", data: { event: value }, externalSessionId };
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
