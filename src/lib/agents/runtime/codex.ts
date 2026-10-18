import type { RuntimeProcessRunner } from "./runner";
import type { WorkerModelConfig } from "@/lib/agents/model-policy";
import type { ReportedTokenUsage } from "@/lib/agents/pricing";
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
      // Codex refuses to run outside a git repo or an explicitly trusted project
      // ("Not inside a trusted directory and --skip-git-repo-check was not
      // specified", exit 1). Verified on the VPS: required whenever
      // AGENT_PROJECT_ROOT is not itself a git repository. Sentinel owns and
      // sandboxes the working directory, so Codex's git heuristic adds nothing.
      "exec", "--json", "--skip-git-repo-check",
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

  protected async reportedSessionModel(externalSessionId: string, startedAt: string, runner?: RuntimeProcessRunner) {
    if (!runner || !/^[a-f0-9-]{36}$/.test(externalSessionId)) return null;
    // Read provenance from this computer, never from Sentinel's host HOME.
    const script = `
      const fs = require('node:fs'), path = require('node:path');
      const [id, start] = process.argv.slice(1);
      for (const offset of [0, 1]) {
        const day = new Date(Date.parse(start) + offset * 86400000).toISOString().slice(0,10).replaceAll('-', '/');
        const dir = path.join(process.env.CODEX_HOME, 'sessions', day);
        for (const file of fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith(id + '.jsonl')) : []) {
          const p = path.join(dir,file); if (fs.statSync(p).size > 16*1024*1024) continue;
          let owned = false, result = null, usage = null;
          for (const line of fs.readFileSync(p,'utf8').split('\\n')) {
            try { const f = JSON.parse(line);
              if (f.type === 'session_meta') owned = (f.payload.id ?? f.payload.session_id) === id;
              if (owned && f.type === 'turn_context' && typeof f.payload.model === 'string') result = {actualModel:f.payload.model, actualEffort:f.payload.effort ?? null, actualModelSource:'runtime_turn_context'};
              if (owned && f.type === 'event_msg' && f.payload?.type === 'token_count') usage = f.payload.info?.total_token_usage ?? usage;
            } catch {}
          }
          if (result) { console.log(JSON.stringify({...result, usage})); process.exit(0); }
        }
      }
    `;
    const result = await runner.run("node", ["-e", script, externalSessionId, startedAt]);
    if (result.exitCode !== 0 || !result.stdout.trim()) return null;
    const { usage, ...reported } = JSON.parse(result.stdout);
    const tokenUsage = codexTokenUsage(usage);
    return { ...reported, ...(tokenUsage ? { tokenUsage } : {}) };
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

function tokenCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function codexTokenUsage(value: unknown): ReportedTokenUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const totalInputTokens = tokenCount(usage.input_tokens);
  const cachedInputTokens = tokenCount(usage.cached_input_tokens);
  const cacheWrite5mInputTokens = tokenCount(usage.cache_write_input_tokens);
  const outputTokens = tokenCount(usage.output_tokens);
  if ([totalInputTokens, cachedInputTokens, cacheWrite5mInputTokens, outputTokens].some((count) => count === null)) return null;
  if (cachedInputTokens! + cacheWrite5mInputTokens! > totalInputTokens!) return null;
  return {
    inputTokens: totalInputTokens! - cachedInputTokens! - cacheWrite5mInputTokens!,
    outputTokens: outputTokens!,
    cachedInputTokens: cachedInputTokens!,
    cacheWrite5mInputTokens: cacheWrite5mInputTokens!,
    cacheWrite1hInputTokens: 0,
  };
}
