// Sentinel memory benchmark — runner.
//
//   npx tsx bench/memory/run.ts --label baseline
//
// Writes a machine-readable report to bench/memory/results/<label>.json and
// prints a human summary. The JSON is the artefact: every later phase is
// compared against it with `--compare <label>`.
//
// Safety: refuses to run unless DATABASE_URL points at a database whose name
// marks it as a throwaway. The benchmark writes fixture users, projects and
// memories; pointing it at the live database would pollute real memory.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { db } from "@/lib/db";
import { aggregate, aggregateByCategory, DEFAULT_K_VALUES } from "./metrics";
import { embeddingMeta, productionRetriever, runCases, seed, teardown, type Retriever } from "./harness";
import { CASES, WORLD } from "./dataset";
import type { BenchReport } from "./types";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, "results");

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string | null = null): string | null => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? (argv[at + 1] ?? fallback) : fallback;
};
const has = (name: string) => argv.includes(`--${name}`);

const RETRIEVERS: Record<string, Retriever> = {
  production: productionRetriever,
};

/** A benchmark that can write to production memory is not a benchmark. */
function assertThrowawayDatabase(): string {
  const url = process.env.DATABASE_URL ?? "";
  if (!url) throw new Error("DATABASE_URL is unset. Point it at the throwaway benchmark database.");
  const parsed = new URL(url);
  const name = parsed.pathname.replace(/^\//, "");
  const throwaway = /vitest|test|bench/i.test(name);
  if (!throwaway && !has("i-know-this-is-not-a-test-database")) {
    throw new Error(
      `Refusing to run: DATABASE_URL database "${name}" is not marked as a test/bench database. ` +
        `The benchmark seeds and deletes fixture rows. Point it at the vitest database ` +
        `(SENTINEL_TEST_DATABASE_URL) or pass --i-know-this-is-not-a-test-database.`,
    );
  }
  return `${parsed.hostname}:${parsed.port}/${name}`;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: join(HERE, "../.."), encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(3) : "n/a";
}

function printSummary(report: BenchReport): void {
  const { overall, meta } = report;
  console.log(`\nSentinel memory benchmark — ${meta.label}`);
  console.log(`  retriever      ${report.cases.length} cases over ${meta.memoryCount} memories`);
  console.log(`  commit         ${meta.commit} (${meta.branch})`);
  console.log(`  embeddings     ${meta.embeddingProvider}/${meta.embeddingModel} dim=${meta.embeddingDimensions ?? "n/a"}`);
  console.log("");
  console.log("  RANKING QUALITY");
  for (const k of meta.kValues) {
    console.log(`    Recall@${String(k).padEnd(2)}  ${fmt(overall.recallAtK[`@${k}`])}    Precision@${String(k).padEnd(2)}  ${fmt(overall.precisionAtK[`@${k}`])}`);
  }
  console.log(`    MRR                    ${fmt(overall.mrr)}`);
  console.log("");
  console.log("  SAFETY");
  console.log(`    false retrieval rate   ${fmt(overall.falseRetrievalRate)}`);
  console.log(`    scope leakage rate     ${fmt(overall.scopeLeakageRate)}`);
  console.log(`    irrelevant retrieval   ${fmt(overall.irrelevantRetrievalRate)}`);
  console.log(`    temporal accuracy      ${overall.temporalAccuracy === null ? "n/a" : fmt(overall.temporalAccuracy)}`);
  console.log("");
  console.log("  COST");
  console.log(`    mean context tokens    ${fmt(overall.meanContextTokens)}`);
  console.log(`    retrieval  mean/p95 ms ${fmt(overall.meanRetrievalLatencyMs)} / ${fmt(overall.p95RetrievalLatencyMs)}`);
  console.log(`    embedding  mean ms     ${fmt(overall.meanEmbeddingLatencyMs)}`);
  console.log(`    rerank     mean ms     ${fmt(overall.meanRerankLatencyMs)}`);
  console.log(`    errors                 ${overall.errors}`);
  console.log("");
  console.log("  BY CATEGORY (recall@10 / precision@10 / false-retrieval)");
  for (const [category, metrics] of Object.entries(report.byCategory)) {
    console.log(
      `    ${category.padEnd(28)} ${fmt(metrics.recallAtK["@10"]).padStart(6)}  ${fmt(metrics.precisionAtK["@10"]).padStart(6)}  ${fmt(metrics.falseRetrievalRate).padStart(6)}  (n=${metrics.cases})`,
    );
  }
}

function printComparison(current: BenchReport, baselineLabel: string): void {
  const path = join(RESULTS_DIR, `${baselineLabel}.json`);
  if (!existsSync(path)) {
    console.log(`\n  (no baseline "${baselineLabel}" to compare against)`);
    return;
  }
  const baseline = JSON.parse(readFileSync(path, "utf8")) as BenchReport;
  const rows: Array<[string, number, number, "higher" | "lower"]> = [
    ["recall@5", baseline.overall.recallAtK["@5"], current.overall.recallAtK["@5"], "higher"],
    ["recall@10", baseline.overall.recallAtK["@10"], current.overall.recallAtK["@10"], "higher"],
    ["precision@10", baseline.overall.precisionAtK["@10"], current.overall.precisionAtK["@10"], "higher"],
    ["mrr", baseline.overall.mrr, current.overall.mrr, "higher"],
    ["false retrieval", baseline.overall.falseRetrievalRate, current.overall.falseRetrievalRate, "lower"],
    ["scope leakage", baseline.overall.scopeLeakageRate, current.overall.scopeLeakageRate, "lower"],
    ["irrelevant", baseline.overall.irrelevantRetrievalRate, current.overall.irrelevantRetrievalRate, "lower"],
    ["context tokens", baseline.overall.meanContextTokens, current.overall.meanContextTokens, "lower"],
  ];
  console.log(`\n  DELTA vs ${baselineLabel}`);
  for (const [name, before, after, better] of rows) {
    const delta = after - before;
    const improved = better === "higher" ? delta > 0 : delta < 0;
    const mark = Math.abs(delta) < 1e-9 ? "  " : improved ? "++" : "!!";
    console.log(`    ${mark} ${name.padEnd(18)} ${fmt(before)} -> ${fmt(after)}  (${delta >= 0 ? "+" : ""}${fmt(delta)})`);
  }
}

async function main(): Promise<void> {
  const label = flag("label", "baseline")!;
  const retrieverName = flag("retriever", "production")!;
  const retriever = RETRIEVERS[retrieverName];
  if (!retriever) {
    throw new Error(`Unknown retriever "${retrieverName}". Known: ${Object.keys(RETRIEVERS).join(", ")}`);
  }

  const databaseUrlHost = assertThrowawayDatabase();
  const startedAt = new Date().toISOString();

  await seed();
  const results = await runCases(retriever, CASES, DEFAULT_K_VALUES);
  if (!has("keep-fixtures")) await teardown();

  const report: BenchReport = {
    meta: {
      label,
      commit: git(["rev-parse", "--short", "HEAD"]),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      startedAt,
      finishedAt: new Date().toISOString(),
      nodeVersion: process.version,
      databaseUrlHost,
      ...embeddingMeta(),
      kValues: DEFAULT_K_VALUES,
      caseCount: CASES.length,
      memoryCount: WORLD.memories.length,
    },
    overall: aggregate(results),
    byCategory: aggregateByCategory(results),
    cases: results,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const out = join(RESULTS_DIR, `${label}.json`);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

  printSummary(report);
  const compare = flag("compare");
  if (compare) printComparison(report, compare);
  console.log(`\n  written ${out}\n`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => {});
  });
