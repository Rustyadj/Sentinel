// Episodic ordering must come from when things happened, not when they were
// written down.
//
// The benchmark's episodic fixtures were recorded in the order they occurred,
// so insertion order and event order agree there and the case cannot tell the
// two apart. This one deliberately disagrees: the events are inserted in
// reverse, which is what happens whenever someone recalls an incident
// afterwards. Ordering by createdAt gets it exactly backwards.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { retrieveContext } from "@/lib/knowledge/retrieval";
import { orderingCue, effectiveEventTime } from "@/lib/knowledge/temporal-intent";

const USER = "temporal-user";
const PROJECT = "temporal-project";
const DAY = 86_400_000;
const IDS = ["temporal-ev-first", "temporal-ev-second", "temporal-ev-third"];

async function cleanup() {
  await db.memoryReconsolidation.deleteMany({ where: { memoryId: { in: IDS } } });
  await db.memoryRetrieval.deleteMany({ where: { memoryId: { in: IDS } } });
  await db.memory.deleteMany({ where: { owner: USER } });
  await db.project.deleteMany({ where: { id: PROJECT } });
  await db.user.deleteMany({ where: { id: USER } });
}

beforeAll(async () => {
  await cleanup();
  await db.user.create({ data: { id: USER, email: "temporal@sentinel.test", name: "T" } });
  await db.project.create({ data: { id: PROJECT, name: "T", userId: USER } });

  const now = Date.now();
  // Inserted newest-event-first; the events happened in the opposite order.
  const rows = [
    { id: "temporal-ev-third", insertedDaysAgo: 3, happenedDaysAgo: 10,
      content: "Finally the gateway migration passed every production probe." },
    { id: "temporal-ev-second", insertedDaysAgo: 4, happenedDaysAgo: 20,
      content: "Then the gateway migration session gate was found swallowing routes." },
    { id: "temporal-ev-first", insertedDaysAgo: 5, happenedDaysAgo: 30,
      content: "At the start of the gateway migration every discovery request returned 401." },
  ];
  for (const row of rows) {
    const createdAt = new Date(now - row.insertedDaysAgo * DAY);
    await db.memory.create({
      data: {
        id: row.id, owner: USER, scope: "project", projectId: PROJECT, type: "episodic",
        source: "test", tags: ["migration"], content: row.content,
        createdAt, updatedAt: createdAt, validFrom: createdAt,
        eventTime: new Date(now - row.happenedDaysAgo * DAY),
      },
    });
  }
});

afterAll(cleanup);

async function idsFor(query: string) {
  const result = await retrieveContext({ userId: USER, projectId: PROJECT, query, scopePolicy: "user-context" });
  return result.memories.map((memory) => memory.id);
}

describe("effectiveEventTime", () => {
  it("prefers event time, then validity, and only then insertion", () => {
    const createdAt = new Date("2026-09-01T00:00:00Z");
    const validFrom = new Date("2026-06-01T00:00:00Z");
    const eventTime = new Date("2026-03-01T00:00:00Z");
    expect(effectiveEventTime({ eventTime, validFrom, createdAt })).toBe(eventTime);
    expect(effectiveEventTime({ eventTime: null, validFrom, createdAt })).toBe(validFrom);
    expect(effectiveEventTime({ eventTime: null, validFrom: null, createdAt })).toBe(createdAt);
  });
});

describe("orderingCue", () => {
  it("recognises questions that want a sequence", () => {
    for (const query of [
      "Walk me through the gateway migration in order.",
      "What happened first in the gateway migration?",
      "What happened after the session gate problem?",
      "Give me the timeline of the gateway migration.",
      "What changed between the first and last probe?",
    ]) {
      expect(orderingCue(query), query).not.toBeNull();
    }
  });

  it("leaves an ordinary question alone", () => {
    for (const query of ["What is the deployment port?", "Which database does this project use?"]) {
      expect(orderingCue(query), query).toBeNull();
    }
  });
});

describe("retrieval ordering", () => {
  it("sequences events by when they happened, not when they were recorded", async () => {
    const ids = await idsFor("Walk me through the gateway migration in order.");
    expect(ids).toEqual(["temporal-ev-first", "temporal-ev-second", "temporal-ev-third"]);
  });

  it("would be exactly reversed if it ordered by insertion", async () => {
    // Guards the assertion above from passing for the wrong reason: the rows
    // really are inserted in the opposite order to the one expected.
    const rows = await db.memory.findMany({
      where: { id: { in: IDS } }, orderBy: { createdAt: "desc" }, select: { id: true },
    });
    expect(rows.map((row) => row.id)).toEqual(["temporal-ev-third", "temporal-ev-second", "temporal-ev-first"]);
  });

  it("does not resequence a question that did not ask for a sequence", async () => {
    // Asks about the *last* event and gives no ordering cue, so relevance
    // decides and the last event comes first. Chronological resequencing would
    // put "-first" at the top instead, which is the whole failure mode: a
    // sequence is only right when a sequence was asked for.
    const ids = await idsFor("Which production probe did the gateway migration pass?");
    expect(ids[0]).toBe("temporal-ev-third");
  });
});
