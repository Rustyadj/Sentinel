"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useCollaborationStore, type ServerRoomSnapshot } from "@/store/useCollaborationStore";
import type { AgentMessageType, CollaborationMode } from "@/types/collaboration";

async function postJson(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (error) {
    console.error(`[collaboration] POST ${url} failed`, error);
  }
}

async function patchJson(url: string, body: unknown): Promise<void> {
  try {
    await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch (error) {
    console.error(`[collaboration] PATCH ${url} failed`, error);
  }
}

/**
 * Transport boundary for the collaboration UI. Wraps the local Zustand
 * store (still mutated synchronously first, so existing UI behavior and
 * tests that assert on it immediately after an interaction keep working)
 * with a real backend: it resolves/creates the user's room, hydrates from
 * GET .../state, subscribes to the room's SSE stream to re-hydrate on
 * every server-side change, and mirrors each action to its API route.
 * All of this is best-effort and silently absent in non-browser
 * environments (SSR, tests without a server) — the room simply keeps
 * running on local fixture/optimistic state in that case.
 */
export function useCollaborationRoom() {
  const room = useCollaborationStore();
  const roomIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const roomId = roomIdRef.current;
    if (!roomId) return;
    try {
      const res = await fetch(`/api/collaboration/rooms/${roomId}/state`);
      if (!res.ok) return;
      const snapshot = (await res.json()) as ServerRoomSnapshot;
      useCollaborationStore.getState().hydrate(snapshot);
    } catch (error) {
      console.error("[collaboration] failed to refresh room state", error);
    }
  }, []);

  useEffect(() => {
    if (typeof fetch === "undefined") return;
    let cancelled = false;
    let eventSource: EventSource | undefined;

    async function init() {
      try {
        const res = await fetch("/api/rooms");
        if (!res.ok || cancelled) return;
        const rooms = (await res.json()) as { id: string; isPrimary?: boolean }[];
        // The primary room is the normal Mission Control experience and
        // always resets to collaborative/Lisa server-side on this fetch
        // (see GET /api/rooms) — pick it explicitly rather than assuming
        // rooms[0] is it, so an ad-hoc direct-worker room never becomes
        // what a fresh session opens into.
        const activeRoom = rooms.find((room) => room.isPrimary) ?? rooms[0];
        if (!activeRoom || cancelled) return;
        roomIdRef.current = activeRoom.id;
        await refresh();
        if (cancelled || typeof EventSource === "undefined") return;
        eventSource = new EventSource(`/api/collaboration/rooms/${activeRoom.id}/stream`);
        eventSource.addEventListener("collaboration-event", () => void refresh());
      } catch (error) {
        console.error("[collaboration] failed to initialize room", error);
      }
    }

    void init();
    return () => {
      cancelled = true;
      eventSource?.close();
    };
  }, [refresh]);

  const sendMessage = useCallback((content: string, recipientAgentIds: string[], type: AgentMessageType = "MESSAGE") => {
    room.sendMessage(content, recipientAgentIds, type);
    if (roomIdRef.current) void postJson(`/api/collaboration/rooms/${roomIdRef.current}/messages`, { content, recipientAgentIds });
  }, [room]);

  const assignTask = useCallback((title: string, ownerAgentId?: string) => {
    room.assignTask(title, ownerAgentId);
    if (roomIdRef.current) void postJson(`/api/collaboration/rooms/${roomIdRef.current}/actions`, { type: "assignTask", title, ownerAgentId });
  }, [room]);

  const cancelTask = useCallback((taskId: string) => {
    room.cancelTask(taskId);
    if (roomIdRef.current) void postJson(`/api/collaboration/rooms/${roomIdRef.current}/actions`, { type: "cancelTask", taskId });
  }, [room]);

  const reassignTask = useCallback((taskId: string, ownerAgentId: string) => {
    room.reassignTask(taskId, ownerAgentId);
    if (roomIdRef.current) void postJson(`/api/collaboration/rooms/${roomIdRef.current}/actions`, { type: "reassignTask", taskId, ownerAgentId });
  }, [room]);

  const stopAgent = useCallback((agentId: string) => {
    room.stopAgent(agentId);
    if (roomIdRef.current) void postJson(`/api/collaboration/rooms/${roomIdRef.current}/actions`, { type: "stopAgent", agentId });
  }, [room]);

  const resolveDisagreement = useCallback((disagreementId: string, agentId: string) => {
    room.resolveDisagreement(disagreementId, agentId);
    if (roomIdRef.current) void postJson(`/api/collaboration/rooms/${roomIdRef.current}/actions`, { type: "resolveDisagreement", disagreementId, agentId });
  }, [room]);

  const setMode = useCallback((mode: CollaborationMode) => {
    room.setMode(mode);
    if (roomIdRef.current) void postJson(`/api/collaboration/rooms/${roomIdRef.current}/actions`, { type: "setMode", mode });
  }, [room]);

  const setPaused = useCallback((paused: boolean) => {
    room.setPaused(paused);
    if (roomIdRef.current) void postJson(`/api/collaboration/rooms/${roomIdRef.current}/actions`, { type: "setPaused", paused });
  }, [room]);

  const approve = useCallback((approvalId: string) => {
    room.approve(approvalId);
    void patchJson(`/api/approvals/${approvalId}`, { status: "approved" });
  }, [room]);

  const deny = useCallback((approvalId: string) => {
    room.deny(approvalId);
    void patchJson(`/api/approvals/${approvalId}`, { status: "rejected" });
  }, [room]);

  const pendingApprovals = useMemo(
    () => room.approvals.filter((approval) => approval.status === "pending"),
    [room.approvals],
  );
  const activeParticipants = useMemo(
    () => room.participants.filter((participant) => participant.health !== "DISCONNECTED" && participant.health !== "FAILED"),
    [room.participants],
  );

  return {
    ...room,
    sendMessage,
    assignTask,
    cancelTask,
    reassignTask,
    stopAgent,
    resolveDisagreement,
    setMode,
    setPaused,
    approve,
    deny,
    pendingApprovals,
    activeParticipants,
  };
}

export type CollaborationRoomController = ReturnType<typeof useCollaborationRoom>;
