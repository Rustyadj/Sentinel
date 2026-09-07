import type { WorkerModelConfig } from "@/lib/agents/model-policy";
import { CliRuntimeAdapter } from "./cli-adapter";
import type { RuntimeCapabilities, RuntimeEvent, RuntimeInstance } from "./types";

/**
 * Verified against Gemini CLI 0.58.0 installed on this VPS.
 *
 * Invocation:
 *   gemini --skip-trust -o stream-json [-m MODEL] -p PROMPT
 *
 * `--skip-trust` is required: without it the CLI aborts with "Gemini CLI is not running
 * in a trusted directory" and produces no output. Sentinel owns and sandboxes the
 * working directory, so the CLI's own trust heuristic adds nothing.
 *
 * The CLI exposes no reasoning-effort control, so `modelConfig.effort` is deliberately
 * not translated into a flag — model-policy rejects a non-null effort for this kind
 * rather than letting the UI offer a setting the runtime cannot honor.
 *
 * Observed stream-json frames:
 *   {"type":"init","session_id":"…","model":"auto"}
 *   {"type":"message","role":"user"|"assistant","content":"…","delta":true}
 *   {"type":"result","status":"success","stats":{"models":{"gemini-3.5-flash":{…}}}}
 *   {"type":"result","status":"error","error":{"message":"…is not found for API version…"}}
 */
export class GeminiRuntimeAdapter extends CliRuntimeAdapter {
  readonly kind = "gemini" as const;
  protected readonly versionArgs = ["--version"];
  // The CLI has no `login status` subcommand; auth lives in ~/.gemini/settings.json and
  // is proven by execution. `--list-extensions` is a cheap authenticated-path no-op.
  protected readonly authArgs = ["--list-extensions"];
  protected readonly supportsResume = true;

  protected buildTaskArgs(runtime: RuntimeInstance, prompt: string, externalSessionId?: string, modelConfig?: WorkerModelConfig) {
    return [
      ...(runtime.args ?? []),
      "--skip-trust",
      "-o", "stream-json",
      ...(modelConfig ? ["-m", modelConfig.runtimeModelId] : []),
      ...(externalSessionId ? ["--resume", externalSessionId] : []),
      "-p", prompt,
    ];
  }

  protected parseStructuredLine(line: string, sessionId: string): { type: RuntimeEvent["type"]; data: Record<string, unknown>; externalSessionId?: string } {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const externalSessionId = typeof value.session_id === "string" ? value.session_id : undefined;

      if (value.type === "init") {
        return { type: "stdout", data: { event: value, requestedModel: value.model }, externalSessionId };
      }
      if (value.type === "message") {
        // Only assistant output is surfaced; the echoed user turn is not agent output.
        if (value.role !== "assistant") return { type: "stdout", data: { event: value }, externalSessionId };
        return { type: "assistant_delta", data: { text: value.content, event: value }, externalSessionId };
      }
      if (value.type === "tool_call" || value.type === "tool_result") {
        return { type: value.type === "tool_call" ? "command_started" : "command_completed", data: { event: value }, externalSessionId };
      }
      if (value.type === "result") {
        // The terminal frame reports the models actually used in stats.models. The router
        // may fan one turn across several models when the request was "auto", so all of
        // them are reported rather than collapsing to the requested id.
        const stats = value.stats as { models?: Record<string, unknown> } | undefined;
        const used = stats?.models && typeof stats.models === "object" ? Object.keys(stats.models) : [];
        return {
          type: value.status === "error" ? "stderr" : "stdout",
          data: { event: value, ...(used.length > 0 ? { actualModel: used.join(",") } : {}) },
          externalSessionId,
        };
      }
      return { type: "stdout", data: { event: value }, externalSessionId };
    } catch {
      // Non-JSON lines are real: the CLI emits true-color and ripgrep warnings on stderr.
      return { type: "stdout", data: { text: line, sessionId } };
    }
  }

  // No reportedSessionModel override: unlike Codex, Gemini has no documented, stable
  // on-disk session format to read back (~/.gemini/history holds only project markers).
  // Provenance instead comes from the live `result` frame above, which the shared
  // cli-adapter persists via parsed.data.actualModel.

  async capabilities(_runtime: RuntimeInstance): Promise<RuntimeCapabilities> {
    return {
      streaming: true,
      resume: true,
      cancel: true,
      toolEvents: true,
      fileChangeEvents: false,
      restart: { supported: false, reason: "runtime_does_not_expose_capability" },
      reload: { supported: false, reason: "runtime_does_not_expose_capability" },
      nativeUi: { supported: false, reason: "runtime_does_not_expose_capability" },
    };
  }
}
