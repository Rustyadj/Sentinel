import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_GLOBE_SETTINGS } from "@/components/neural-lens/graphSettings";
import { useGraphStore, type RecentTrace } from "@/store/useGraphStore";

function trace(id: string, nodeIds = ["alpha", "bravo", "charlie"], capturedAt = 1_000): RecentTrace {
  return { id, label: nodeIds.join(" → "), nodeIds, capturedAt };
}

describe("trace replay store", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useGraphStore.setState({
      recentTraces: [],
      activeTrace: null,
      traceStepIndex: 0,
      tracePlaying: false,
      graphSettings: { ...DEFAULT_GLOBE_SETTINGS, animate: true },
    });
  });

  it("deduplicates consecutive near-identical traces and caps history newest-first", () => {
    const { addRecentTrace } = useGraphStore.getState();
    addRecentTrace(trace("original", ["alpha", "bravo"], 1_000));
    addRecentTrace(trace("duplicate", ["alpha", "bravo"], 4_000));

    expect(useGraphStore.getState().recentTraces.map((item) => item.id)).toEqual(["original"]);

    for (let index = 1; index <= 8; index += 1) {
      addRecentTrace(trace(`trace-${index}`, [`node-${index}`, `node-${index + 1}`], 10_000 * index));
    }

    const recent = useGraphStore.getState().recentTraces;
    expect(recent).toHaveLength(8);
    expect(recent[0]?.id).toBe("trace-8");
    expect(recent.some((item) => item.id === "original")).toBe(false);

    const persisted = window.localStorage.getItem("sentinel.neural-lens.view-state") ?? "";
    expect(persisted).not.toBe("");
    expect(persisted).not.toContain("recentTraces");
    expect(persisted).not.toContain("activeTrace");
    expect(persisted).not.toContain("traceStepIndex");
    expect(persisted).not.toContain("tracePlaying");
  });

  it("starts selected traces only when graph animation is enabled", () => {
    const selected = trace("selected");
    useGraphStore.getState().selectTrace(selected);
    expect(useGraphStore.getState()).toMatchObject({
      activeTrace: selected,
      traceStepIndex: 0,
      tracePlaying: true,
    });

    useGraphStore.getState().setGraphSettings({ animate: false });
    expect(useGraphStore.getState().tracePlaying).toBe(false);

    useGraphStore.getState().selectTrace(selected);
    expect(useGraphStore.getState().tracePlaying).toBe(false);
  });

  it("clamps manual steps and pauses playback", () => {
    useGraphStore.getState().selectTrace(trace("manual"));

    useGraphStore.getState().stepTrace(-1);
    expect(useGraphStore.getState()).toMatchObject({ traceStepIndex: 0, tracePlaying: false });

    useGraphStore.getState().stepTrace(99);
    expect(useGraphStore.getState()).toMatchObject({ traceStepIndex: 2, tracePlaying: false });

    useGraphStore.getState().stepTrace(-1);
    expect(useGraphStore.getState()).toMatchObject({ traceStepIndex: 1, tracePlaying: false });
  });

  it("auto-advance stops at the final step and restart/exit reset transport state", () => {
    useGraphStore.getState().selectTrace(trace("playback"));

    useGraphStore.getState().advanceTrace();
    expect(useGraphStore.getState()).toMatchObject({ traceStepIndex: 1, tracePlaying: true });

    useGraphStore.getState().advanceTrace();
    expect(useGraphStore.getState()).toMatchObject({ traceStepIndex: 2, tracePlaying: false });

    useGraphStore.getState().restartTrace();
    expect(useGraphStore.getState()).toMatchObject({ traceStepIndex: 0, tracePlaying: false });

    useGraphStore.getState().exitTrace();
    expect(useGraphStore.getState()).toMatchObject({
      activeTrace: null,
      traceStepIndex: 0,
      tracePlaying: false,
    });
  });
});
