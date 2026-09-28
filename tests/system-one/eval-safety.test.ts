// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EVAL_CASES } from "../../bench/system1/eval-cases";
import { planRoute } from "@/lib/system-one/policy";
import { toReadOnlyDescriptors, type ListedTool } from "@/lib/system-one/read-only-tools";
import { SYSTEM_ONE_INTENTS, SYSTEM_ONE_ROUTES, type SystemOneIntent, type SystemOneRoute } from "@/lib/system-one/types";
import { confidentToolDecision, testConfig } from "./fixtures";

const snapshot = JSON.parse(readFileSync(join(process.cwd(), "bench/system1/mobileops-tools.snapshot.json"), "utf8")) as { tools: ListedTool[] };
const catalog = toReadOnlyDescriptors("mobileops", snapshot.tools);
const mutating = snapshot.tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);

describe("fast-path safety over the real MobileOps catalog", () => {
  it("lists every read-only tool and no mutating one", () => {
    expect(mutating.length).toBeGreaterThan(15);
    expect(catalog).toHaveLength(snapshot.tools.length - mutating.length);
    for (const t of catalog) expect(mutating).not.toContain(t.name);
  });

  it("cannot be steered to a mutating tool by any decision, however confident", () => {
    const intents = Object.keys(SYSTEM_ONE_INTENTS) as SystemOneIntent[];
    const routes = Object.keys(SYSTEM_ONE_ROUTES) as SystemOneRoute[];
    const candidates = [...catalog.map((t) => t.id), ...mutating.map((n) => `mobileops.${n}`), "other.tool", null];
    let rng = 42;
    const rand = () => ((rng = (rng * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 5_000; i += 1) {
      const decision = confidentToolDecision({
        intent: intents[Math.floor(rand() * intents.length)],
        route: routes[Math.floor(rand() * routes.length)],
        suggestedTool: candidates[Math.floor(rand() * candidates.length)],
        readOnly: rand(), needsSystem2: rand(), needsClarification: rand(), needsSearch: rand(),
        confidence: 0.5 + rand() / 2,
        confidences: { intent: 1, route: 1, tool: rand() },
      });
      const plan = planRoute({ decision, surface: "voice", config: testConfig(), tools: catalog, memoryRetrievalSkippable: false });
      if (plan.action === "fast_path_tool") {
        expect(mutating).not.toContain(plan.tool!.name);
        expect(catalog.map((t) => t.id)).toContain(plan.tool!.id);
      }
    }
  });

  it("gives an agent with no connector nothing to fast-path", () => {
    const plan = planRoute({ decision: confidentToolDecision(), surface: "voice", config: testConfig(), tools: [], memoryRetrievalSkippable: false });
    expect(plan.action).toBe("system2");
  });
});

describe("eval set integrity", () => {
  const eligible = new Set(catalog.filter((t) => t.fastPathEligible).map((t) => t.name));

  it("covers every required category with at least three cases", () => {
    const categories = ["simple_conversation", "memory_retrieval", "inventory_lookup", "mcp_call", "web_search", "coding", "multi_step_reasoning", "ambiguous", "agent_specific", "voice", "permission_sensitive"];
    for (const c of categories) expect(EVAL_CASES.filter((e) => e.category === c).length, c).toBeGreaterThanOrEqual(3);
  });

  it("only labels tools that exist, are read-only and are fast-path eligible", () => {
    for (const c of EVAL_CASES) for (const t of c.tools) expect(eligible.has(t), `${c.id}: ${t}`).toBe(true);
  });

  it("never labels a case both fast-pathable and unsafe", () => {
    for (const c of EVAL_CASES) expect(Boolean(c.unsafeToFastPath && c.tools.length), c.id).toBe(false);
  });

  it("has unique ids", () => {
    expect(new Set(EVAL_CASES.map((c) => c.id)).size).toBe(EVAL_CASES.length);
  });
});
