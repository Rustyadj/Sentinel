import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { ACTIVITY_POLL_MS, GRAPH_REFRESH_MS, useOrreryData } from "./useOrreryData";
import { OrreryStatusStrip, orreryNotices } from "./OrreryStatusStrip";
import type { OrreryActivity, OrreryEvent } from "@/lib/orrery/types";

type Node = { id: string; type: string; title: string };
type Edge = { id: string; fromObjectId: string; toObjectId: string; type: string; weight: number };

const world = {
  graph: { nodes: [] as Node[], edges: [] as Edge[], partial: false } as { nodes: Node[]; edges: Edge[]; partial: boolean },
  graphStatus: 200,
  activityStatus: 200,
  activity: null as OrreryActivity | null,
  activityUrls: [] as string[],
  focus: new Map<string, { status: number; body: unknown }>(),
};

const node = (id: string, title = id, type = "Task"): Node => ({ id, type, title });
const activity = (events: OrreryEvent[] = [], extra: Partial<OrreryActivity> = {}): OrreryActivity => ({
  cursor: "2026-10-08T12:00:00.000Z", truncated: false, events, agents: [{ agentId: "codex", state: "idle", nodeId: null }], runs: [], approvals: [], ...extra,
});
const event = (id: string): OrreryEvent => ({ id, at: "2026-10-08T12:00:00.000Z", agentId: "codex", verb: "exec", text: id, nodeIds: [] });

beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(world, { graph: { nodes: [node("a"), node("b"), node("c")], edges: [], partial: false }, graphStatus: 200, activityStatus: 200, activity: activity(), activityUrls: [], focus: new Map() });
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = String(input);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (url.startsWith("/api/orrery/activity")) { world.activityUrls.push(url); return world.activityStatus === 200 ? json(200, world.activity) : json(world.activityStatus, { error: "boom" }); }
    const focusId = new URL(url, "http://x").searchParams.get("focus");
    if (focusId) { const f = world.focus.get(focusId); return f ? json(f.status, f.body) : json(404, { error: "Node not found" }); }
    return world.graphStatus === 200 ? json(200, world.graph) : json(world.graphStatus, { error: "boom" });
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("graph reconciliation", () => {
  it("shows renamed objects and drops removed ones on the next refresh", async () => {
    const { result } = renderHook(() => useOrreryData(() => undefined));
    await flush();
    expect(result.current.status).toBe("ready");
    expect(result.current.model?.nodeCount).toBe(3);

    world.graph = { nodes: [node("a", "Renamed A"), node("b")], edges: [], partial: false }; // c deleted
    await tick(GRAPH_REFRESH_MS);
    expect(result.current.model?.nodeCount).toBe(2);
    expect(result.current.model?.labels).toContain("Renamed A");
    expect(result.current.model?.ids).not.toContain("c");
  });

  it("drops an edge that was removed", async () => {
    world.graph = { nodes: [node("a"), node("b")], edges: [{ id: "e1", fromObjectId: "a", toObjectId: "b", type: "related_to", weight: 1 }], partial: false };
    const { result } = renderHook(() => useOrreryData(() => undefined));
    await flush();
    expect(result.current.model?.edgeCount).toBe(1);
    world.graph = { ...world.graph, edges: [] };
    await tick(GRAPH_REFRESH_MS);
    expect(result.current.model?.edgeCount).toBe(0);
  });

  it("an emptied graph is shown as empty, not as an error", async () => {
    const { result } = renderHook(() => useOrreryData(() => undefined));
    await flush();
    world.graph = { nodes: [], edges: [], partial: false };
    await tick(GRAPH_REFRESH_MS);
    expect(result.current.status).toBe("ready");
    expect(result.current.model?.nodeCount).toBe(0);
    expect(result.current.graphHealth.error).toBeNull();
  });

  it("keeps an agent's own node (read by focus) only while the server still returns it", async () => {
    world.graph = { nodes: [node("a")], edges: [], partial: true };
    world.activity = activity([], { agents: [{ agentId: "codex", state: "working", nodeId: "agent-node" }] });
    world.focus.set("agent-node", { status: 200, body: { nodes: [node("agent-node", "Codex", "Agent")], edges: [], partial: false } });
    const { result } = renderHook(() => useOrreryData(() => undefined));
    await flush();
    expect(result.current.model?.ids).toContain("agent-node");

    world.focus.set("agent-node", { status: 404, body: { error: "Node not found" } }); // deleted or no longer readable
    await tick(GRAPH_REFRESH_MS);
    expect(result.current.model?.ids).not.toContain("agent-node");
  });
});

describe("failures are visible and non-destructive", () => {
  it("a failing graph refresh keeps the last good globe, reports the error and the age of the data, then recovers", async () => {
    const { result } = renderHook(() => useOrreryData(() => undefined));
    await flush();
    const loadedAt = result.current.graphHealth.lastOkAt;
    expect(loadedAt).not.toBeNull();

    world.graphStatus = 500;
    await tick(GRAPH_REFRESH_MS);
    expect(result.current.status).toBe("ready");
    expect(result.current.model?.nodeCount).toBe(3);
    expect(result.current.graphHealth).toMatchObject({ error: "Request failed (500)", failures: 1, lastOkAt: loadedAt });

    world.graphStatus = 200;
    await tick(GRAPH_REFRESH_MS);
    expect(result.current.graphHealth).toMatchObject({ error: null, failures: 0 });
  });

  it("a failing activity poll keeps the last good feed and state but says the activity is stale", async () => {
    world.activity = activity([event("e1")]);
    const { result } = renderHook(() => useOrreryData(() => undefined));
    await flush();
    expect(result.current.feed.map((e) => e.id)).toEqual(["e1"]);

    world.activityStatus = 503;
    await tick(ACTIVITY_POLL_MS * 2);
    expect(result.current.feed.map((e) => e.id)).toEqual(["e1"]);
    expect(result.current.activity).not.toBeNull();
    expect(result.current.activityHealth.error).toBe("Request failed (503)");
    expect(result.current.activityHealth.failures).toBeGreaterThanOrEqual(2);

    world.activityStatus = 200;
    await tick(ACTIVITY_POLL_MS);
    expect(result.current.activityHealth.error).toBeNull();
  });

  it("an expired session is reported as such", async () => {
    world.graphStatus = 401;
    const { result } = renderHook(() => useOrreryData(() => undefined));
    await flush();
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("Sign in to see the graph.");
  });

  it("retry re-reads both sources immediately", async () => {
    const { result } = renderHook(() => useOrreryData(() => undefined));
    await flush();
    world.graphStatus = 500; world.activityStatus = 500;
    await tick(GRAPH_REFRESH_MS);
    expect(result.current.graphHealth.error).not.toBeNull();
    world.graphStatus = 200; world.activityStatus = 200;
    await act(async () => { result.current.retry(); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.graphHealth.error).toBeNull();
    expect(result.current.activityHealth.error).toBeNull();
  });
});

describe("activity cursor", () => {
  it("sends the cursor back, and shows an event the server re-offers at the boundary only once", async () => {
    const seen: OrreryEvent[][] = [];
    world.activity = activity([event("e1")]);
    const { result } = renderHook(() => useOrreryData((events) => seen.push(events)));
    await flush();
    expect(world.activityUrls[0]).toBe("/api/orrery/activity");

    world.activity = activity([event("e1"), event("e2")], { cursor: "2026-10-08T12:00:03.000Z" });
    await tick(ACTIVITY_POLL_MS);
    expect(world.activityUrls[1]).toBe(`/api/orrery/activity?since=${encodeURIComponent("2026-10-08T12:00:00.000Z")}`);
    expect(result.current.feed.map((e) => e.id)).toEqual(["e2", "e1"]);
    expect(seen.flat().map((e) => e.id)).toEqual(["e2"]); // history on open is not replayed as movement; e1 is not repeated
  });

  it("flags a truncated page so the viewer knows the feed is catching up", async () => {
    world.activity = activity([], { truncated: true });
    const { result } = renderHook(() => useOrreryData(() => undefined));
    await flush();
    expect(result.current.activityTruncated).toBe(true);
  });
});

describe("notices", () => {
  const healthy = { error: null, lastOkAt: Date.UTC(2026, 9, 8, 12, 0, 0), failures: 0 };
  it("says nothing when everything is fine", () => {
    expect(orreryNotices({ ready: true, graph: healthy, activity: healthy, partial: false, activityTruncated: false })).toEqual([]);
  });
  it("names the failing source, the error, and the age of what is on screen", () => {
    const notices = orreryNotices({ ready: true, graph: healthy, activity: { error: "Request failed (503)", lastOkAt: healthy.lastOkAt, failures: 3 }, partial: false, activityTruncated: false });
    expect(notices).toEqual([expect.objectContaining({ id: "activity", tone: "error", text: expect.stringMatching(/Agent activity is not updating: Request failed \(503\) Showing data from \d{2}:\d{2}:\d{2}\./) })]);
  });
  it("before the first successful read, says nothing has loaded", () => {
    const never = { error: "Request failed (500)", lastOkAt: null, failures: 1 };
    expect(orreryNotices({ ready: true, graph: healthy, activity: never, partial: false, activityTruncated: false })[0].text).toMatch(/Nothing has loaded yet/);
  });
  it("renders a retry that calls back", async () => {
    const onRetry = vi.fn();
    render(<OrreryStatusStrip notices={[{ id: "graph", tone: "error", text: "Graph is not updating" }]} onRetry={onRetry} />);
    expect(screen.getByRole("status")).toHaveTextContent("Graph is not updating");
    screen.getByRole("button", { name: /retry now/i }).click();
    expect(onRetry).toHaveBeenCalled();
  });
});
