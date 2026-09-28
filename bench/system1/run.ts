/**
 * System 1 benchmark: routing correctness and decision latency against the
 * labelled eval set, using the real provider.
 *
 *   OPENROUTER_API_KEY=… npx tsx bench/system1/run.ts [--repeat 3] [--tools] [--out dir]
 *
 * --tools additionally executes each correct fast path's read-only tool for
 * real (needs SENTINEL_AGENT_MCP_HERMES_NATHAN2_URL/_TOKEN) to measure tool
 * latency. It never runs a System 2 (Hermes) turn: those write to the agents'
 * real memory. The System 2 baseline comes from bench/system1/baseline.json,
 * measured from production's own runtime event log.
 *
 * Reports what was measured and labels what was projected. Exit code 1 if any
 * unsafe case was fast-pathed — latency never excuses a wrong route.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveSystemOneConfig } from "@/lib/system-one/config";
import { planRoute } from "@/lib/system-one/policy";
import { JevProvider } from "@/lib/system-one/providers/jev";
import { callReadOnlyTool, listReadOnlyTools, toReadOnlyDescriptors, type ListedTool } from "@/lib/system-one/read-only-tools";
import { SystemOneDecisionService } from "@/lib/system-one/service";
import type { ReadOnlyToolDescriptor, SystemOneResult } from "@/lib/system-one/types";
import { EVAL_CASES, type EvalCase } from "./eval-cases";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const repeat = Math.max(1, Number(option("--repeat", "3")));
const outDir = option("--out", join(process.cwd(), "bench/system1/results"));

const config = resolveSystemOneConfig({ ...process.env, SYSTEM_ONE_MODE: "active" });
if (!config.apiKey) {
  console.error("No System One key: set OPENROUTER_API_KEY (or SYSTEM_ONE_API_KEY). Nothing was measured.");
  process.exit(2);
}

const snapshot = JSON.parse(readFileSync(join(process.cwd(), "bench/system1/mobileops-tools.snapshot.json"), "utf8")) as { source: string; tools: ListedTool[] };
const baseline = JSON.parse(readFileSync(join(process.cwd(), "bench/system1/baseline.json"), "utf8")) as Record<string, unknown>;

async function toolsFor(agentId: string, live: boolean): Promise<ReadOnlyToolDescriptor[]> {
  if (agentId !== "hermes-nathan2") return [];
  if (live) {
    const tools = await listReadOnlyTools(agentId);
    if (tools.length) return tools;
    console.warn("live catalog unavailable; using snapshot");
  }
  return toReadOnlyDescriptors("mobileops", snapshot.tools);
}

const pct = (values: number[], p: number) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};

interface CaseResult {
  id: string;
  category: string;
  route: string | null;
  routeOk: boolean;
  action: string;
  tool: string | null;
  verdict: "correct" | "missed_fast_path" | "wrong_fast_path" | "unsafe_fast_path" | "fallback";
  memoryVerdict?: "skipped_correctly" | "skipped_wrongly" | "kept";
  confidence: number | null;
  latencies: number[];
  toolLatencyMs?: number;
  costUsd: number;
  outcomes: string[];
}

async function main() {
  const provider = new JevProvider({ apiKey: config.apiKey!, baseUrl: config.baseUrl, model: config.model });
  // A large breaker threshold: the benchmark measures failures, it must not hide them.
  const service = new SystemOneDecisionService(provider, { ...config, breaker: { failureThreshold: 1_000, openMs: 1_000 } });
  const liveTools = flag("--tools");
  const results: CaseResult[] = [];
  let providerModel: string | null = null;

  // Warm the connection once so the first case does not carry TLS setup.
  await service.decide({ request: "hello", surface: "voice", agentId: "hermes-lisa", tools: [] }, { timeoutMs: 5_000 });

  for (const c of EVAL_CASES) {
    const tools = await toolsFor(c.agentId, liveTools);
    const runs: SystemOneResult[] = [];
    for (let i = 0; i < repeat; i += 1) {
      // Generous timeout here: we want the real latency distribution, not a truncated one.
      runs.push(await service.decide({ request: c.request, surface: c.surface, agentId: c.agentId, tools, recentTurns: c.recentTurns }, { timeoutMs: 5_000 }));
    }
    const first = runs.find((r) => r.outcome === "ok") ?? runs[0];
    providerModel ??= first.providerModel;
    const plan = planRoute({
      decision: first.decision,
      surface: c.surface,
      config: { ...config, fastPathSurfaces: new Set([c.surface]) },
      tools,
      memoryRetrievalSkippable: c.agentId === "assistant" && c.surface === "chat",
    });
    results.push(score(c, first, plan.action, plan.tool?.name ?? null, runs));
    const last = results[results.length - 1];
    if (liveTools && plan.action === "fast_path_tool" && plan.tool && last.verdict === "correct") {
      const t = await callReadOnlyTool({ agentId: c.agentId, toolId: plan.tool.id, arguments: plan.toolArguments });
      if (t.ok) last.toolLatencyMs = t.latencyMs;
    }
    process.stdout.write(`${c.id.padEnd(10)} ${last.verdict.padEnd(18)} route=${String(last.route).padEnd(14)} ${last.action}${last.tool ? `:${last.tool}` : ""} conf=${last.confidence?.toFixed(2)}\n`);
  }

  report(results, providerModel);
}

function score(c: EvalCase, r: SystemOneResult, action: string, tool: string | null, runs: SystemOneResult[]): CaseResult {
  const d = r.decision;
  let verdict: CaseResult["verdict"];
  if (!d) verdict = "fallback";
  else if (action === "fast_path_tool") {
    if (c.unsafeToFastPath) verdict = "unsafe_fast_path";
    else verdict = tool && c.tools.includes(tool) ? "correct" : "wrong_fast_path";
  } else verdict = c.tools.length > 0 ? "missed_fast_path" : "correct";

  let memoryVerdict: CaseResult["memoryVerdict"];
  if (c.memorySkippable !== undefined) {
    memoryVerdict = action === "system2_skip_memory" ? (c.memorySkippable ? "skipped_correctly" : "skipped_wrongly") : "kept";
  }
  return {
    id: c.id,
    category: c.category,
    route: d?.route ?? null,
    routeOk: Boolean(d && c.routes.includes(d.route)),
    action,
    tool,
    verdict,
    memoryVerdict,
    confidence: d?.confidence ?? null,
    latencies: runs.filter((x) => x.outcome === "ok").map((x) => x.latencyMs),
    costUsd: runs.reduce((s, x) => s + (x.costUsd ?? 0), 0),
    outcomes: runs.map((x) => x.outcome),
  };
}

function report(results: CaseResult[], providerModel: string | null) {
  const n = results.length;
  const count = (f: (r: CaseResult) => boolean) => results.filter(f).length;
  const latencies = results.flatMap((r) => r.latencies);
  const toolLatencies = results.map((r) => r.toolLatencyMs).filter((v): v is number => v !== undefined);
  const expectedFast = results.filter((r) => EVAL_CASES.find((c) => c.id === r.id)!.tools.length > 0);
  const fastTaken = results.filter((r) => r.action === "fast_path_tool");
  const unsafe = count((r) => r.verdict === "unsafe_fast_path");
  const allCalls = results.reduce((s, r) => s + r.outcomes.length, 0);
  const failedCalls = results.reduce((s, r) => s + r.outcomes.filter((o) => o !== "ok").length, 0);
  const memoryCases = results.filter((r) => r.memoryVerdict);

  const byCategory = [...new Set(results.map((r) => r.category))].map((cat) => {
    const rs = results.filter((r) => r.category === cat);
    return `| ${cat} | ${rs.length} | ${rs.filter((r) => r.routeOk).length}/${rs.length} | ${rs.filter((r) => r.verdict === "correct").length}/${rs.length} | ${rs.filter((r) => r.verdict === "unsafe_fast_path").length} |`;
  });

  const lines = [
    `# System 1 benchmark — ${new Date().toISOString()}`,
    "",
    `Provider: ${config.baseUrl} · requested model \`${config.model}\` · served by \`${providerModel ?? "unknown"}\` · ${repeat} calls per case · ${n} cases`,
    `Thresholds: route high ${config.thresholds.route.high} / low ${config.thresholds.route.low}, tool high ${config.thresholds.tool.high}, noul ${config.thresholds.noul}`,
    `Tool catalog: ${flag("--tools") ? "live (falls back to snapshot)" : `snapshot — ${snapshot.source}`}`,
    "",
    "## Safety and correctness (measured)",
    "",
    `- **Unsafe fast paths: ${unsafe}** ${unsafe ? "— FAIL" : "(required: 0)"}`,
    `- Wrong-tool fast paths: ${count((r) => r.verdict === "wrong_fast_path")}`,
    `- Route accuracy: ${count((r) => r.routeOk)}/${n} (${((count((r) => r.routeOk) / n) * 100).toFixed(0)}%)`,
    `- End-to-end routing verdict correct: ${count((r) => r.verdict === "correct")}/${n}`,
    `- Fast-path recall: ${expectedFast.filter((r) => r.verdict === "correct").length}/${expectedFast.length} cases a tool could answer`,
    `- Fast-path precision: ${fastTaken.filter((r) => r.verdict === "correct").length}/${fastTaken.length} fast paths taken were the right tool`,
    `- Memory skip: ${memoryCases.filter((r) => r.memoryVerdict === "skipped_correctly").length} correct skips, **${memoryCases.filter((r) => r.memoryVerdict === "skipped_wrongly").length} wrong skips**, ${memoryCases.filter((r) => r.memoryVerdict === "kept").length} kept (of ${memoryCases.length})`,
    `- Provider fallback rate: ${failedCalls}/${allCalls} calls`,
    "",
    "| category | n | route ok | verdict correct | unsafe |",
    "|---|---|---|---|---|",
    ...byCategory,
    "",
    "## Latency and cost (measured)",
    "",
    `- System 1 decision: p50 **${pct(latencies, 50)} ms**, p95 **${pct(latencies, 95)} ms** (${latencies.length} calls, client-side wall clock incl. network)`,
    `- Fast-path tool execution: ${toolLatencies.length ? `p50 ${pct(toolLatencies, 50)} ms, p95 ${pct(toolLatencies, 95)} ms (${toolLatencies.length} calls)` : "not measured (run with --tools)"}`,
    `- System 1 cost: $${results.reduce((s, r) => s + r.costUsd, 0).toFixed(6)} for ${allCalls} calls ($${(results.reduce((s, r) => s + r.costUsd, 0) / Math.max(1, allCalls)).toFixed(7)} per decision, provider-reported)`,
    "",
    "## System 2 baseline (measured in production, see baseline.json)",
    "",
    "```json",
    JSON.stringify(baseline, null, 2),
    "```",
    "",
    "## Projection — NOT measured end to end",
    "",
    `On this eval set, active mode would have avoided System 2 on ${fastTaken.filter((r) => r.verdict === "correct").length}/${n} requests. For those, projected latency = System 1 p50 + tool p50; the rest pay the System 1 wait on voice (bounded by the ${config.voiceTimeoutMs} ms timeout) on top of the baseline. These are sums of measured components, not a measured end-to-end run.`,
    "",
    "## Per case",
    "",
    "| id | verdict | route | action | confidence | p50 ms |",
    "|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${r.verdict} | ${r.route ?? "–"} | ${r.action}${r.tool ? `:${r.tool}` : ""} | ${r.confidence?.toFixed(2) ?? "–"} | ${pct(r.latencies, 50) ?? "–"} |`),
  ];

  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  writeFileSync(join(outDir, `${stamp}.md`), lines.join("\n"));
  writeFileSync(join(outDir, `${stamp}.json`), JSON.stringify({ config: { ...config, apiKey: undefined, fastPathSurfaces: [...config.fastPathSurfaces] }, providerModel, results }, null, 2));
  console.log(`\n${lines.slice(0, 30).join("\n")}\n\nFull report: ${join(outDir, `${stamp}.md`)}`);
  process.exit(unsafe > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(3);
});
