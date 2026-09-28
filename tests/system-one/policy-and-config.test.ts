// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveAgentMode, resolveSystemOneConfig } from "@/lib/system-one/config";
import { planRoute } from "@/lib/system-one/policy";
import { buildDecisionRequest, interpretAnswers, NO_TOOL } from "@/lib/system-one/questions";
import { bucketTool, confidentToolDecision, searchTool, statusTool, testConfig } from "./fixtures";

const plan = (decision: ReturnType<typeof confidentToolDecision> | null, overrides: Partial<Parameters<typeof planRoute>[0]> = {}) =>
  planRoute({ decision, surface: "voice", config: testConfig(), tools: [statusTool, bucketTool, searchTool], memoryRetrievalSkippable: false, ...overrides });

describe("confidence-gated routing", () => {
  it("fast-paths a confident read-only lookup to its tool, without System 2", () => {
    const p = plan(confidentToolDecision());
    expect(p.action).toBe("fast_path_tool");
    expect(p.tool?.id).toBe(statusTool.id);
    expect(p.tier).toBe("high");
  });

  it("takes today's path when there is no decision (timeout, error, breaker)", () => {
    expect(plan(null).action).toBe("system2");
  });

  it.each([
    [0.7, "medium"],
    [0.3, "low"],
  ])("does not act on a route confidence of %s (%s)", (confidence, tier) => {
    const p = plan(confidentToolDecision({ confidence }));
    expect(p.action).toBe("system2");
    expect(p.tier).toBe(tier);
  });

  it("never fast-paths a write, however confident", () => {
    const p = plan(confidentToolDecision({ intent: "write_action" }));
    expect(p.action).toBe("system2");
    expect(p.reasons.join(" ")).toMatch(/write_action/);
  });

  it("requires the request itself to be read-only", () => {
    expect(plan(confidentToolDecision({ readOnly: 0.6 })).action).toBe("system2");
  });

  it("escalates when System 1 thinks real reasoning or clarification is needed", () => {
    expect(plan(confidentToolDecision({ needsSystem2: 0.4 })).action).toBe("system2");
    expect(plan(confidentToolDecision({ needsClarification: 0.3 })).action).toBe("system2");
  });

  it("refuses a tool that is not in the agent's authorized read-only list", () => {
    // e.g. a decision that names another agent's tool, or a mutating one.
    const p = plan(confidentToolDecision({ suggestedTool: "mobileops.equipment_checkout" }));
    expect(p.action).toBe("system2");
    expect(p.reasons.join(" ")).toMatch(/no authorized tool/);
  });

  it("refuses a tool with a free-text argument System 1 cannot fill", () => {
    expect(plan(confidentToolDecision({ suggestedTool: searchTool.id })).action).toBe("system2");
  });

  it("fills enum arguments, and refuses when a required one is unanswered", () => {
    const filled = plan(confidentToolDecision({ suggestedTool: bucketTool.id, suggestedToolArguments: { bucket: "repair" } }));
    expect(filled.action).toBe("fast_path_tool");
    expect(filled.toolArguments).toEqual({ bucket: "repair" });
    expect(plan(confidentToolDecision({ suggestedTool: bucketTool.id })).action).toBe("system2");
  });

  it("keeps the fast path to the surfaces it is enabled on", () => {
    expect(plan(confidentToolDecision(), { surface: "runtime_chat" }).action).toBe("system2");
    const enabled = testConfig({ SYSTEM_ONE_FAST_PATH_SURFACES: "voice,runtime_chat" });
    expect(plan(confidentToolDecision(), { surface: "runtime_chat", config: enabled }).action).toBe("fast_path_tool");
  });

  it("skips memory only where Sentinel retrieves it and the request clearly does not need it", () => {
    const smallTalk = confidentToolDecision({ intent: "small_talk", route: "fast_reply", suggestedTool: null, needsMemory: 0.03 });
    expect(plan(smallTalk, { surface: "chat", memoryRetrievalSkippable: true }).action).toBe("system2_skip_memory");
    expect(plan(smallTalk, { surface: "chat", memoryRetrievalSkippable: false }).action).toBe("system2");
    const recall = { ...smallTalk, intent: "memory_recall" as const, route: "memory_answer" as const, needsMemory: 0.02 };
    expect(plan(recall, { surface: "chat", memoryRetrievalSkippable: true }).action).toBe("system2");
    expect(plan({ ...smallTalk, needsMemory: 0.3 }, { surface: "chat", memoryRetrievalSkippable: true }).action).toBe("system2");
  });

  it("honours per-decision thresholds", () => {
    const strict = testConfig({ SYSTEM_ONE_TOOL_HIGH_CONFIDENCE: "0.99" });
    expect(plan(confidentToolDecision(), { config: strict }).action).toBe("system2");
  });
});

describe("configuration", () => {
  it("defaults to off, with a pinned model and strict timeouts", () => {
    const c = resolveSystemOneConfig({});
    expect(c.mode).toBe("off");
    expect(c.model).toBe("jev-1.13");
    expect(c.voiceTimeoutMs).toBe(250);
    expect(c.apiKey).toBeNull();
    expect([...c.fastPathSurfaces]).toEqual(["voice"]);
  });

  it("lets SYSTEM_ONE_ENABLED=false override every mode, including per-agent", () => {
    const env = { SYSTEM_ONE_ENABLED: "false", SYSTEM_ONE_MODE: "active", SYSTEM_ONE_MODE_HERMES_NATHAN2: "active" };
    expect(resolveSystemOneConfig(env).mode).toBe("off");
    expect(resolveAgentMode("hermes-nathan2", env)).toBe("off");
  });

  it("disables every fast path with SYSTEM_ONE_FAST_PATH_SURFACES=none (the documented rollback)", () => {
    expect(resolveSystemOneConfig({ SYSTEM_ONE_FAST_PATH_SURFACES: "none" }).fastPathSurfaces.size).toBe(0);
  });

  it("supports a per-agent mode override", () => {
    const env = { SYSTEM_ONE_MODE: "shadow", SYSTEM_ONE_MODE_HERMES_NATHAN2: "active" };
    expect(resolveAgentMode("hermes-nathan2", env)).toBe("active");
    expect(resolveAgentMode("hermes-lisa", env)).toBe("shadow");
  });

  it("clamps an inverted or out-of-range threshold band", () => {
    const c = resolveSystemOneConfig({ SYSTEM_ONE_ROUTE_HIGH_CONFIDENCE: "0.6", SYSTEM_ONE_ROUTE_LOW_CONFIDENCE: "0.9", SYSTEM_ONE_TIMEOUT_MS: "999999" });
    expect(c.thresholds.route.low).toBeLessThanOrEqual(c.thresholds.route.high);
    expect(c.timeoutMs).toBe(5_000);
  });
});

describe("decision bundle", () => {
  it("asks every decision in one request", () => {
    const req = buildDecisionRequest({ request: "hi", surface: "voice", agentId: "hermes-lisa", tools: [statusTool, bucketTool] });
    expect(Object.keys(req.questions)).toEqual(expect.arrayContaining([
      "intent", "route", "tool", "needs_memory", "needs_tool", "needs_search", "needs_system2", "needs_clarification", "read_only", "complexity", "urgency", "arg__1__bucket",
    ]));
    const tool = req.questions.tool;
    expect(tool.type === "choice" && Object.keys(tool.criteria)).toEqual([statusTool.id, bucketTool.id, NO_TOOL]);
  });

  it("omits the tool question for an agent with no read-only tools", () => {
    const req = buildDecisionRequest({ request: "hi", surface: "chat", agentId: "hermes-lisa", tools: [] });
    expect(req.questions.tool).toBeUndefined();
    expect((req.state.available_tools as unknown[]).length).toBe(0);
  });

  it("keeps state small: at most two prior turns, each truncated", () => {
    const turns = Array.from({ length: 6 }, (_, i) => ({ role: "user" as const, content: `turn ${i} ${"x".repeat(5_000)}` }));
    const req = buildDecisionRequest({ request: "hi", surface: "chat", agentId: "a", tools: [], recentTurns: turns });
    const recent = req.state.recent_conversation as Array<{ content: string }>;
    expect(recent).toHaveLength(2);
    expect(recent[0].content.length).toBeLessThanOrEqual(600);
  });

  it("normalises scores and echoes — never chooses — the configured model", () => {
    const d = interpretAnswers(
      { request: "x", surface: "voice", agentId: "a", tools: [], configuredModel: "gpt-5.6-luna" },
      {
        route: { type: "choice", choice: "agent_runtime", probabilities: {}, confidence: 0.7 },
        complexity: { type: "score", score: 3, probabilities: {}, confidence: 0.9, levels: 4 },
      },
    );
    expect(d.complexity).toBe(1);
    expect(d.suggestedModel).toBe("gpt-5.6-luna");
    expect(d.suggestedTool).toBeNull();
  });
});
