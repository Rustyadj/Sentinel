import { create } from "zustand";
import type { Memory, MemoryType, MemoryScope } from "@/types";

interface MemoryFilter {
  scope: MemoryScope | "all";
  type: MemoryType | "all";
  search: string;
}

interface MemoryState {
  memories: Memory[];
  filter: MemoryFilter;
  hydrated: boolean;
}

interface MemoryActions {
  setMemories: (memories: Memory[]) => void;
  addMemory: (memory: Memory) => void;
  updateMemory: (memoryId: string, updates: Partial<Memory>) => void;
  deleteMemory: (memoryId: string) => void;
  pinMemory: (memoryId: string, pinned: boolean) => void;
  archiveMemory: (memoryId: string, archived: boolean) => void;
  setFilter: (filter: Partial<MemoryFilter>) => void;
  setHydrated: (value: boolean) => void;
}

type MemoryStore = MemoryState & MemoryActions;

export const useMemoryStore = create<MemoryStore>((set) => ({
  // State — start empty; the memory page hydrates from DB
  memories: [],
  filter: {
    scope: "all",
    type: "all",
    search: "",
  },
  hydrated: false,

  // Actions
  setMemories: (memories) => set({ memories }),

  addMemory: (memory) =>
    set((state) => ({
      memories: [memory, ...state.memories],
    })),

  updateMemory: (memoryId, updates) =>
    set((state) => ({
      memories: state.memories.map((m) =>
        m.id === memoryId ? { ...m, ...updates, updatedAt: new Date() } : m
      ),
    })),

  deleteMemory: (memoryId) => {
    // Optimistic update; fire-and-forget API call
    void fetch(`/api/memories/${memoryId}`, { method: "DELETE" }).catch(
      (err) => console.error("[memory] delete failed:", err)
    );
    set((state) => ({
      memories: state.memories.filter((m) => m.id !== memoryId),
    }));
  },

  pinMemory: (memoryId, pinned) => {
    // Optimistic update; fire-and-forget API call
    void fetch(`/api/memories/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    }).catch((err) => console.error("[memory] pin failed:", err));
    set((state) => ({
      memories: state.memories.map((m) =>
        m.id === memoryId ? { ...m, pinned, updatedAt: new Date() } : m
      ),
    }));
  },

  archiveMemory: (memoryId, archived) => {
    // Optimistic update; fire-and-forget API call
    void fetch(`/api/memories/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived }),
    }).catch((err) => console.error("[memory] archive failed:", err));
    set((state) => ({
      memories: state.memories.map((m) =>
        m.id === memoryId ? { ...m, archived, updatedAt: new Date() } : m
      ),
    }));
  },

  setFilter: (filter) =>
    set((state) => ({
      filter: { ...state.filter, ...filter },
    })),

  setHydrated: (value) => set({ hydrated: value }),
}));

// Selector helpers
export const selectFilteredMemories = (state: MemoryStore): Memory[] => {
  const { memories, filter } = state;
  return memories.filter((m) => {
    if (m.archived) return false;
    if (filter.scope !== "all" && m.scope !== filter.scope) return false;
    if (filter.type !== "all" && m.type !== filter.type) return false;
    if (
      filter.search &&
      !m.content.toLowerCase().includes(filter.search.toLowerCase()) &&
      !m.tags.some((t) =>
        t.toLowerCase().includes(filter.search.toLowerCase())
      )
    ) {
      return false;
    }
    return true;
  });
};

export const selectPinnedMemories = (state: MemoryStore): Memory[] =>
  state.memories.filter((m) => m.pinned && !m.archived);
