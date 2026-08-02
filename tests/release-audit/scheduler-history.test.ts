import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { runRecordedScheduledJob } from "@/lib/neural-engine/scheduler-service";
import { uid } from "../neural-engine/db-setup";

afterAll(async () => db.$disconnect());

describe("release audit — scheduled job history", () => {
  it("records completed non-degradation worker jobs with their real result", async () => {
    const jobKey = uid("co-occurrence-discovery");
    const recorded = await runRecordedScheduledJob(jobKey, async () => ({ candidatesCreated: 2 }));
    const row = await db.scheduledJobRun.findUniqueOrThrow({ where: { id: recorded.jobRunId } });

    expect(row.jobKey).toBe(jobKey);
    expect(row.status).toBe("completed");
    expect(row.completedAt).not.toBeNull();
    expect(row.result).toEqual({ candidatesCreated: 2 });
  });

  it("records terminal failure details before rethrowing", async () => {
    const jobKey = uid("knowledge-gap-analysis");
    await expect(runRecordedScheduledJob(jobKey, async () => {
      throw new Error("audit fixture failed");
    })).rejects.toThrow("audit fixture failed");

    const row = await db.scheduledJobRun.findFirstOrThrow({
      where: { jobKey },
      orderBy: { startedAt: "desc" },
    });
    expect(row.status).toBe("failed");
    expect(row.completedAt).not.toBeNull();
    expect(row.error).toBe("audit fixture failed");
  });
});
