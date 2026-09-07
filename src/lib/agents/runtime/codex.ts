import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { WorkerModelConfig } from "@/lib/agents/model-policy";
import { CliRuntimeAdapter } from "./cli-adapter";
import type { RuntimeCapabilities, RuntimeEvent, RuntimeInstance } from "./types";

/**
 * Verified on VPS Codex 0.147.0/0.153.4: global options precede exec;
 * exec --json --model MODEL -c model_reasoning_effort="LEVEL".
 * Model access is verified by execution, independently of flag support.
 */
export class CodexRuntimeAdapter extends CliRuntimeAdapter {
  readonly kind = "codex" as const;
  protected readonly versionArgs = ["--version"];
  protected readonly authArgs = ["login", "status"];
  protected readonly supportsResume = false;

  protected buildTaskArgs(runtime: RuntimeInstance, prompt: string, _externalSessionId?: string, modelConfig?: WorkerModelConfig) {
    return [
      ...(runtime.args ?? []),
      "exec", "--json",
      ...(modelConfig ? ["--model", modelConfig.runtimeModelId, ...(modelConfig.effort ? ["-c", `model_reasoning_effort="${modelConfig.effort}"`] : [])] : []),
      prompt,
    ];
  }

  protected parseStructuredLine(line: string, sessionId: string): { type: RuntimeEvent["type"]; data: Record<string, unknown>; externalSessionId?: string } {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      const externalSessionId = typeof value.thread_id === "string" ? value.thread_id : undefined;
      const item = value.item && typeof value.item === "object" ? value.item as Record<string, unknown> : undefined;
      if (item?.type === "agent_message" && value.type === "item.completed") return { type: "assistant_delta", data: { text: item.text, event: value }, externalSessionId };
      if (item?.type === "command_execution") return { type: value.type === "item.started" ? "command_started" : "command_completed", data: { command: item.command, exitCode: item.exit_code, event: value }, externalSessionId };
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

  protected async reportedSessionModel(externalSessionId: string, startedAt: string) {
    if (!/^[a-f0-9-]{36}$/.test(externalSessionId)) return null;
    const home = process.env.CODEX_HOME ?? join(process.env.HOME ?? "/nonexistent", ".codex");
    // Read only the runtime-created file for this owned session. Never import transcripts.
    for (const dayOffset of [0, 1]) {
      const date = new Date(new Date(startedAt).getTime() + dayOffset * 86400000).toISOString().slice(0, 10).replaceAll("-", "/");
      const directory = join(home, "sessions", date);
      const files = await readdir(directory).catch(() => [] as string[]);
      for (const file of files.filter(name => name.endsWith(`${externalSessionId}.jsonl`))) {
        const path = join(directory, file);
        if ((await stat(path)).size > 16 * 1024 * 1024) continue;
        const lines = (await readFile(path, "utf8")).split("\n");
        let owned = false;
        let reported: Record<string, unknown> | null = null;
        for (const line of lines) {
          try {
            const frame = JSON.parse(line);
            if (frame.type === "session_meta") owned = (frame.payload.id ?? frame.payload.session_id) === externalSessionId;
            if (owned && frame.type === "turn_context" && typeof frame.payload.model === "string") {
              reported = { actualModel: frame.payload.model, actualEffort: frame.payload.effort ?? null, actualModelSource: "runtime_turn_context" };
            }
          } catch { /* An incomplete last JSONL frame is not provenance. */ }
        }
        if (reported) return reported;
      }
    }
    return null;
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
