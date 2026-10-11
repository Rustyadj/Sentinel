import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chunkForSpeech, FragmentLog, TurnRecorder } from "./transcript";

describe("chunkForSpeech", () => {
  it("keeps short answers whole and splits long ones at sentence boundaries within limits", () => {
    expect(chunkForSpeech("Yes, we do.")).toEqual(["Yes, we do."]);
    const long = Array.from({ length: 200 }, (_, i) => `Sentence number ${i}.`).join(" ");
    const chunks = chunkForSpeech(long);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(4);
    expect(chunks.every((c) => c.length <= 1_500)).toBe(true);
    expect(chunkForSpeech("   ")).toEqual([]);
  });
});

describe("FragmentLog", () => {
  it("rebuilds an utterance between two timeline offsets", () => {
    const log = new FragmentLog();
    log.add({ start: 100, end: 200, text: "Do you " });
    log.add({ start: 200, end: 300, text: "have it?" });
    log.add({ start: 900, end: 1000, text: "Next one" });
    expect(log.utterance(-1, 400)).toBe("Do you have it?");
    expect(log.utterance(400, Infinity)).toBe("Next one");
    expect(log.covers(1000, 250)).toBe(true);
    expect(log.covers(5000, 250)).toBe(false);
  });
});

describe("TurnRecorder", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("flushes each speaker after silence and on demand", () => {
    const onTurn = vi.fn();
    const rec = new TurnRecorder(onTurn, 1_000);
    rec.push("caller", "hello ", 10);
    rec.push("caller", "there", 20);
    rec.push("agent", "Hi!", 30);
    vi.advanceTimersByTime(1_100);
    expect(onTurn).toHaveBeenCalledWith({ role: "caller", text: "hello there", offsetMs: 10 });
    expect(onTurn).toHaveBeenCalledWith({ role: "agent", text: "Hi!", offsetMs: 30 });
    rec.push("agent", "Bye", 99);
    rec.flush();
    expect(rec.turns).toHaveLength(3);
  });
});
