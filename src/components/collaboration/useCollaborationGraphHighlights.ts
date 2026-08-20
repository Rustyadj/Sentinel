"use client";

import { useEffect, useMemo } from "react";
import { useGraphStore } from "@/store/useGraphStore";
import type { CollaborationRoomController } from "./useCollaborationRoom";

function payloadText(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function useCollaborationGraphHighlights(room: CollaborationRoomController): string[] {
  const requestFocus = useGraphStore((state) => state.requestFocus);
  const setPinnedTitles = useGraphStore((state) => state.setPinnedTitles);
  const latestEvent = room.events.at(-1);

  const highlightedTitles = useMemo(() => {
    const titles = new Set<string>();
    for (const participant of room.participants) {
      if (participant.health === "BUSY" || participant.activeTaskId) titles.add(participant.name);
    }
    if (room.selectedTaskId) {
      const task = room.tasks.find((item) => item.id === room.selectedTaskId);
      if (task) titles.add(task.title);
    }
    if (room.selectedArtifactId) {
      const artifact = room.artifacts.find((item) => item.id === room.selectedArtifactId);
      if (artifact) titles.add(artifact.title);
    }
    if (latestEvent) {
      for (const key of ["title", "file", "agentName", "taskTitle"]) {
        const value = payloadText(latestEvent.payload, key);
        if (value) titles.add(value);
      }
    }
    return Array.from(titles);
  }, [latestEvent, room.artifacts, room.participants, room.selectedArtifactId, room.selectedTaskId, room.tasks]);

  useEffect(() => {
    setPinnedTitles(highlightedTitles);
    return () => setPinnedTitles([]);
  }, [highlightedTitles, setPinnedTitles]);

  useEffect(() => {
    if (!latestEvent) return;
    const title = payloadText(latestEvent.payload, "title")
      ?? payloadText(latestEvent.payload, "taskTitle")
      ?? payloadText(latestEvent.payload, "agentName");
    if (title) requestFocus(title);
  }, [latestEvent, requestFocus]);

  return highlightedTitles;
}
