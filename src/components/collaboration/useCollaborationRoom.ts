"use client";

import { useMemo } from "react";
import { useCollaborationStore } from "@/store/useCollaborationStore";

/**
 * Transport boundary for the collaboration UI. Today it reads the local
 * fixture store; the backend track can replace this file with its SSE/WS
 * subscription without changing the room components.
 */
export function useCollaborationRoom() {
  const room = useCollaborationStore();
  const pendingApprovals = useMemo(
    () => room.approvals.filter((approval) => approval.status === "pending"),
    [room.approvals],
  );
  const activeParticipants = useMemo(
    () => room.participants.filter((participant) => participant.health !== "DISCONNECTED" && participant.health !== "FAILED"),
    [room.participants],
  );

  return { ...room, pendingApprovals, activeParticipants };
}

export type CollaborationRoomController = ReturnType<typeof useCollaborationRoom>;
