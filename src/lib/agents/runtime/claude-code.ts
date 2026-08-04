import { CliRuntimeAdapter } from "./cli-adapter";
import type { RuntimeCapabilities, RuntimeEvent, RuntimeInstance } from "./types";

/**
 * Built against the documented Claude Code non-interactive contract:
 * `-p`, `--output-format stream-json`, `--resume`, and `--permission-mode`.
 * The real VPS binary/version/auth state is intentionally left unverified until
 * scripts/vps-acceptance-test.sh is run on srv1427612.hstgr.cloud.
 */
export class ClaudeCodeRuntimeAdapter extends CliRuntimeAdapter {
  readonly kind = "claude-code" as const;
  protected readonly versionArgs = ["--version"];
  protected readonly authArgs = ["auth", "status"];
  protected readonly supportsResume = true;

  protected buildTaskArgs(runtime: RuntimeInstance, prompt: string, externalSessionId?: string) {
    return [
      ...(runtime.args ?? []),
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
