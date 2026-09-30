import { describe, expect, it } from "vitest";
import {
  callerMatches, canWriteMemoryScope, evaluateDelegation, evaluateObservedTool, evaluateToolAccess, memoryReadScopes,
  memoryWriteScopes, renderToolManifest, resolveObservedTool, type CatalogServer, type PermissionRow,
} from "@/lib/bots/policy";
import { delegationPolicySchema, memoryPolicySchema, toBotTaskStatus } from "@/lib/bots/schema";

const catalog: CatalogServer[] = [
  { id: "sentinel", slug: "sentinel", name: "Sentinel", tools: [
    { name: "sentinel.memory_search", readOnly: true }, { name: "sentinel.route_task", readOnly: false },
  ] },
  { id: "hermes-builtin", slug: "hermes", name: "Hermes built-in tools", tools: [
    { name: "read_file", readOnly: true }, { name: "terminal", readOnly: false }, { name: "delegate_task", readOnly: false, risk: "high" },
  ] },
  { id: "gen", slug: "creative-gen", name: "Creative Gen", tools: [
    { name: "generate_image", readOnly: false }, { name: "list_styles", readOnly: true }, { name: "mystery", readOnly: null },
  ] },
  // A second server that exposes a tool with the same bare name as the first.
  { id: "gen2", slug: "other-gen", name: "Other Gen", tools: [{ name: "generate_image", readOnly: false }] },
];

const row = (serverId: string, toolName: string, permission: PermissionRow["permission"]): PermissionRow => ({ serverId, toolName, permission });
const access = (rows: PermissionRow[], serverId: string, toolName: string, readOnly: boolean | null) =>
  evaluateToolAccess(rows, { serverId, toolName, readOnly });

describe("evaluateToolAccess", () => {
  it("denies by default: no grant means no access", () => {
    const decision = access([], "gen", "list_styles", true);
    expect(decision).toMatchObject({ allowed: false, requiresApproval: false, permission: "none", source: "none" });
  });

  it("read admits only tools the server marked read-only", () => {
    const rows = [row("gen", "*", "read")];
    expect(access(rows, "gen", "list_styles", true).allowed).toBe(true);
    expect(access(rows, "gen", "generate_image", false).allowed).toBe(false);
  });

  it("read refuses a tool whose read-only status is unknown (fails closed)", () => {
    const decision = access([row("gen", "*", "read")], "gen", "mystery", null);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/unknown/);
  });

  it("execute admits state-changing tools", () => {
    expect(access([row("gen", "*", "execute")], "gen", "generate_image", false)).toMatchObject({ allowed: true, permission: "execute", source: "server" });
  });

  it("approval never allows outright but flags that approval is needed", () => {
    expect(access([row("gen", "generate_image", "approval")], "gen", "generate_image", false)).toMatchObject({ allowed: false, requiresApproval: true });
  });

  it("a tool-level row overrides the server-level one in both directions", () => {
    const widened = [row("gen", "*", "disabled"), row("gen", "list_styles", "read")];
    expect(access(widened, "gen", "list_styles", true)).toMatchObject({ allowed: true, source: "tool" });
    expect(access(widened, "gen", "generate_image", false).allowed).toBe(false);
    const narrowed = [row("gen", "*", "execute"), row("gen", "generate_image", "disabled")];
    expect(access(narrowed, "gen", "generate_image", false)).toMatchObject({ allowed: false, permission: "disabled", source: "tool" });
    expect(access(narrowed, "gen", "list_styles", true).allowed).toBe(true);
  });

  it("a grant on one server never leaks to another", () => {
    expect(access([row("gen", "*", "execute")], "gen2", "generate_image", false).allowed).toBe(false);
  });

  it("a one-time approval admits exactly that tool", () => {
    const approved = new Set(["gen:generate_image"]);
    expect(evaluateToolAccess([row("gen", "generate_image", "approval")], { serverId: "gen", toolName: "generate_image", readOnly: false }, approved)).toMatchObject({ allowed: true, source: "approved" });
    expect(evaluateToolAccess([row("gen", "*", "approval")], { serverId: "gen", toolName: "other", readOnly: false }, approved).allowed).toBe(false);
  });
});

describe("resolveObservedTool / evaluateObservedTool", () => {
  it("recognises the spellings a runtime reports", () => {
    for (const reported of ["sentinel.memory_search", "sentinel_memory_search", "memory_search", "mcp_sentinel_memory_search", "mcp_sentinel_sentinel_memory_search"]) {
      expect(resolveObservedTool(reported, catalog).map((tool) => tool.toolName), reported).toEqual(["sentinel.memory_search"]);
    }
    expect(resolveObservedTool("mcp_creative_gen_list_styles", catalog)[0]).toMatchObject({ serverId: "gen", toolName: "list_styles" });
  });

  it("denies a tool that is in no catalog", () => {
    const verdict = evaluateObservedTool([row("hermes-builtin", "*", "execute")], "sms_spoof", catalog);
    expect(verdict).toMatchObject({ allowed: false, source: "unknown-tool", resolved: null });
  });

  it("uses the strictest verdict when two servers expose the same name", () => {
    const rows = [row("gen", "*", "execute")]; // gen2 has no grant
    const verdict = evaluateObservedTool(rows, "generate_image", catalog);
    expect(verdict.allowed).toBe(false);
    expect(verdict.resolved?.serverId).toBe("gen2");
    const both = evaluateObservedTool([row("gen", "*", "execute"), row("gen2", "*", "execute")], "generate_image", catalog);
    expect(both.allowed).toBe(true);
  });

  it("does not let the read-only builtin grant cover terminal", () => {
    const rows = [row("hermes-builtin", "*", "read")];
    expect(evaluateObservedTool(rows, "read_file", catalog).allowed).toBe(true);
    expect(evaluateObservedTool(rows, "terminal", catalog).allowed).toBe(false);
    expect(evaluateObservedTool(rows, "delegate_task", catalog).allowed).toBe(false);
  });
});

describe("renderToolManifest", () => {
  it("lists what is permitted and what needs approval, and states the rest is forbidden", () => {
    const text = renderToolManifest([row("hermes-builtin", "read_file", "read"), row("gen", "generate_image", "approval")], catalog);
    expect(text).toContain("read_file");
    expect(text).toMatch(/generate_image need approval/);
    expect(text).not.toContain("terminal");
    expect(text).toMatch(/not listed is forbidden/);
  });
  it("says so when there are no tools at all", () => {
    expect(renderToolManifest([], catalog)).toMatch(/no tools/i);
  });
});

describe("delegation policy", () => {
  const policy = (over: Record<string, unknown> = {}) => delegationPolicySchema.parse(over);
  const target = (over: Record<string, unknown> = {}, status = "active") => ({ id: "child", status, delegationPolicy: policy(over) });

  it("matches callers exactly, and 'user' matches any user key", () => {
    expect(callerMatches(["agent:hermes-lisa"], "agent:hermes-lisa")).toBe(true);
    expect(callerMatches(["agent:hermes-lisa"], "agent:hermes-nathan2")).toBe(false);
    expect(callerMatches(["user"], "user:u1")).toBe(true);
    expect(callerMatches(["user"], "agent:hermes-lisa")).toBe(false);
    expect(callerMatches([], "user:u1")).toBe(false);
  });

  it("refuses inactive bots and unlisted callers", () => {
    expect(evaluateDelegation({ target: target({ allowedCallers: ["agent:a"] }, "disabled"), callerKey: "agent:a" }).allowed).toBe(false);
    expect(evaluateDelegation({ target: target({ allowedCallers: ["agent:a"] }), callerKey: "agent:b" }).allowed).toBe(false);
    expect(evaluateDelegation({ target: target({ allowedCallers: ["agent:a"] }), callerKey: "agent:a" }).allowed).toBe(true);
  });

  const parent = (over: Record<string, unknown>, chain: string[]) => ({ bot: { id: chain[chain.length - 1], status: "active", delegationPolicy: policy(over) }, chain });

  it("a bot may not delegate unless its policy allows it, and only to listed children", () => {
    const t = target({ allowedCallers: ["bot:root"] });
    expect(evaluateDelegation({ target: t, callerKey: "bot:root", parent: parent({ canDelegate: false, allowedChildBots: ["child"] }, ["root"]) }).allowed).toBe(false);
    expect(evaluateDelegation({ target: t, callerKey: "bot:root", parent: parent({ canDelegate: true, allowedChildBots: [] }, ["root"]) }).allowed).toBe(false);
    expect(evaluateDelegation({ target: t, callerKey: "bot:root", parent: parent({ canDelegate: true, allowedChildBots: ["child"] }, ["root"]) }).allowed).toBe(true);
  });

  it("refuses loops back to a bot already on the chain", () => {
    const decision = evaluateDelegation({ target: target({ allowedCallers: ["bot:b"] }), callerKey: "bot:b", parent: parent({ canDelegate: true, allowedChildBots: ["child"], maxDepth: 3 }, ["child", "b"]) });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/loop/);
  });

  it("enforces depth: the default lets a root bot spawn level-1 children but they cannot go deeper", () => {
    const t = target({ allowedCallers: ["bot:b"] });
    expect(evaluateDelegation({ target: t, callerKey: "bot:b", parent: parent({ canDelegate: true, allowedChildBots: ["child"], maxDepth: 1 }, ["root"]) }).allowed).toBe(true);
    expect(evaluateDelegation({ target: t, callerKey: "bot:b", parent: parent({ canDelegate: true, allowedChildBots: ["child"], maxDepth: 1 }, ["root", "mid"]) }).allowed).toBe(false);
    expect(evaluateDelegation({ target: t, callerKey: "bot:b", parent: parent({ canDelegate: true, allowedChildBots: ["child"], maxDepth: 3 }, ["root", "mid"]) }).allowed).toBe(true);
  });

  it("the schema caps depth at the global ceiling", () => {
    expect(() => policy({ maxDepth: 4 })).toThrow();
  });

  it("defaults to user-only callers and no delegation", () => {
    expect(policy()).toMatchObject({ allowedCallers: ["user"], canDelegate: false, allowedChildBots: [] });
  });
});

describe("memory policy", () => {
  it("disabled memory yields no scopes at all", () => {
    const policy = memoryPolicySchema.parse({ enabled: false, readScopes: ["bot", "project"], writeScopes: ["bot"] });
    expect(memoryReadScopes(policy)).toEqual([]);
    expect(memoryWriteScopes(policy)).toEqual([]);
    expect(canWriteMemoryScope(policy, "bot")).toBe(false);
  });
  it("write access is separate from read access", () => {
    const policy = memoryPolicySchema.parse({ readScopes: ["bot", "project", "workspace"], writeScopes: ["bot"] });
    expect(memoryReadScopes(policy)).toContain("workspace");
    expect(canWriteMemoryScope(policy, "workspace")).toBe(false);
    expect(canWriteMemoryScope(policy, "bot")).toBe(true);
  });
  it("rejects unknown scopes and out-of-range limits", () => {
    expect(() => memoryPolicySchema.parse({ readScopes: ["everything"] })).toThrow();
    expect(() => memoryPolicySchema.parse({ minRelevance: 2 })).toThrow();
    expect(() => memoryPolicySchema.parse({ maxItems: 0 })).toThrow();
  });
});

describe("task status vocabulary", () => {
  it("maps run states to the six task states", () => {
    expect(toBotTaskStatus("queued")).toBe("QUEUED");
    expect(toBotTaskStatus("running")).toBe("RUNNING");
    expect(toBotTaskStatus("cancelling")).toBe("RUNNING");
    expect(toBotTaskStatus("waiting")).toBe("WAITING");
    expect(toBotTaskStatus("succeeded")).toBe("COMPLETED");
    expect(toBotTaskStatus("failed")).toBe("FAILED");
    expect(toBotTaskStatus("cancelled")).toBe("CANCELLED");
  });
});
