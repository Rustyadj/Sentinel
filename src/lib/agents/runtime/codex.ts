import type { WorkerModelConfig } from "@/lib/agents/model-policy";
import { CliRuntimeAdapter } from "./cli-adapter";
import type { RuntimeCapabilities, RuntimeEvent, RuntimeInstance } from "./types";

/**
 * Built against the documented Codex CLI contract: `codex exec --json` with
 * workspace-write sandboxing and on-request approval. Resume is reported as
 * unsupported instead of being emulated. The real VPS binary remains unverified.
 *
 * `--model`/`-c model_reasoning_effort=...` below request the model-policy
 * resolved runtime id and effort explicitly. Like the rest of this
 * adapter's flags, the exact syntax is Sentinel's best-effort mapping and
 * unverified against the real installed CLI until the VPS acceptance test
 * runs.
 */
export class CodexRuntimeAdapter extends CliRuntimeAdapter {
  readonly kind = "codex" as const;
  protected readonly versionArgs = ["--version"];
  protected readonly authArgs = ["login", "status"];
  protected readonly supportsResume = false;

  protected buildTaskArgs(runtime: RuntimeInstance, prompt: string, _externalSessionId?: string, modelConfig?: WorkerModelConfig) {
    return [
      "exec", "--json",
      ...(runtime.args ?? []),
      ...(modelConfig ? ["--model", modelConfig.runtimeModelId, "-c", `model_reasoning_effort="${modelConfig.effort}"`] : []),
      prompt,
    ];
  }

  protected parseStructuredLine(line: string, sessionId: string): { type: RuntimeEvent["type"]; data: Record<string, unknown>; externalSessionId?: string } {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const externalSessionId = typeof value.thread_id === "string" ? value.thread_id : undefined;
      const type = typeof value.type === "string" ? value.type : "";
      if (type.includes("message") || type.includes("assistant")) return { type: "assistant_delta", data: { event: value }, externalSessionId };
      if (type.includes("command") && type.includes("started")) return { type: "command_started", data: { event: value }, externalSessionId };
      if (type.includes("command") && type.includes("completed")) return { type: "command_completed", data: { event: value }, externalSessionId };
      if (type.includes("file")) return { type: "file_changed", data: { event: value }, externalSessionId };
      if (type.includes("approval")) return { type: "approval_required", data: { event: value }, externalSessionId };
      return { type: "stdout", data: { event: value }, externalSessionId };
    } catch {
      return { type: "stdout", data: { text: line, sessionId } };
    }
  }

  async capabilities(runtime: RuntimeInstance): Promise<RuntimeCapabilities> {
    void runtime;
    return {
      streaming: true,
      resume: false,
      cancel: true,
      toolEvents: true,
      fileChangeEvents: true,
      restart: { supported: false, reason: "runtime_does_not_expose_capability" },
      reload: { supported: false, reason: "runtime_does_not_expose_capability" },
    };
  }
}
