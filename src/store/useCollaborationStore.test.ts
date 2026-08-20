import { beforeEach, describe, expect, it } from "vitest";
import { useCollaborationStore } from "./useCollaborationStore";

beforeEach(() => useCollaborationStore.getState().reset());

describe("useCollaborationStore", () => {
  it("creates, reassigns, and cancels tasks with matching events", () => {
    const store = useCollaborationStore.getState();
    store.assignTask("Validate transport boundary", "claude-code");
    const created = useCollaborationStore.getState().tasks.at(-1);
    expect(created?.status).toBe("QUEUED");
    if (!created) throw new Error("Task fixture was not created");
    useCollaborationStore.getState().reassignTask(created.id, "codex");
    expect(useCollaborationStore.getState().tasks.at(-1)?.ownerAgentId).toBe("codex");
    useCollaborationStore.getState().cancelTask(created.id);
    expect(useCollaborationStore.getState().tasks.at(-1)?.status).toBe("CANCELLED");
    expect(useCollaborationStore.getState().events.at(-1)?.payload.status).toBe("cancelled");
  });

  it("records approval decisions and operator-stopped agent health", () => {
    useCollaborationStore.getState().approve("APR-7");
    expect(useCollaborationStore.getState().approvals[0].status).toBe("approved");
    useCollaborationStore.getState().stopAgent("claude-code");
    const agent = useCollaborationStore.getState().participants.find((participant) => participant.agentId === "claude-code");
    expect(agent).toMatchObject({ health: "DISCONNECTED", status: "Stopped", activeTaskId: undefined });
  });
});
