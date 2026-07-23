import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttentionItem, MissionControlData } from "./types";
import { HttpMissionControlService } from "./service";

const approval: AttentionItem = {
  id: "approval:abc", targetId: "abc", targetType: "approval", href: "/workflows?tab=approvals",
  title: "Approve release", detail: "Release abc", category: "approval", severity: "high",
  owner: "Release manager", source: "workspace", timestamp: "now", actions: ["approve", "reject"],
};

afterEach(() => vi.unstubAllGlobals());

describe("HttpMissionControlService", () => {
  it("loads the single authenticated aggregation endpoint without caching", async () => {
    const data = { greetingName: "Rusty" } as MissionControlData;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new HttpMissionControlService().load()).resolves.toEqual(data);
    expect(fetchMock).toHaveBeenCalledWith("/api/mission-control", expect.objectContaining({ cache: "no-store" }));
  });

  it("sends approval decisions to the persisted approval API", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new HttpMissionControlService().resolveAttention(approval, "approve")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith("/api/approvals/abc", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "approved" }) }));
  });

  it("does not report success when the decision API rejects the write", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })));
    await expect(new HttpMissionControlService().resolveAttention(approval, "reject")).rejects.toThrow("Forbidden");
  });
});
