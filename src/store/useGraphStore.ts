import { create } from "zustand";

export type GraphTimeWindow = "all" | "7d" | "30d" | "90d";

const TIME_WINDOW_MS: Record<Exclude<GraphTimeWindow, "all">, number> = {
  "7d": 7 * 86_400_000,
  "30d": 30 * 86_400_000,
  "90d": 90 * 86_400_000,
};

interface GraphUIState {
  search: string;
  activeTypes: Set<string>;
  focusMode: boolean;
  clustering: boolean;
  timeWindow: GraphTimeWindow;
  /** Epoch-ms cutoff derived when the window is chosen; 0 means no cutoff. */
  timeWindowCutoff: number;
  selectedNodeId: string | null;
  /** One-shot request to focus a node by title (from chat references). */
  focusRequest: { title: string; ts: number } | null;
  /** Incrementing counter — KnowledgeGraph fits the view when it changes. */
  fitRequest: number;
}

interface GraphUIActions {
  setSearch: (search: string) => void;
  toggleType: (type: string) => void;
  clearTypes: () => void;
  setFocusMode: (on: boolean) => void;
  setClustering: (on: boolean) => void;
  setTimeWindow: (window: GraphTimeWindow) => void;
  selectNode: (id: string | null) => void;
  requestFocus: (title: string) => void;
  requestFit: () => void;
}

export type GraphStore = GraphUIState & GraphUIActions;

export const useGraphStore = create<GraphStore>((set) => ({
  search: "",
  activeTypes: new Set<string>(),
  focusMode: false,
  clustering: false,
  timeWindow: "all",
  timeWindowCutoff: 0,
  selectedNodeId: null,
  focusRequest: null,
  fitRequest: 0,

  setSearch: (search) => set({ search }),
  toggleType: (type) =>
    set((state) => {
      const next = new Set(state.activeTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { activeTypes: next };
    }),
  clearTypes: () => set({ activeTypes: new Set() }),
  setFocusMode: (focusMode) => set({ focusMode }),
  setClustering: (clustering) => set({ clustering }),
  setTimeWindow: (timeWindow) =>
    set({
      timeWindow,
      timeWindowCutoff:
        timeWindow === "all" ? 0 : Date.now() - TIME_WINDOW_MS[timeWindow],
    }),
  selectNode: (selectedNodeId) => set({ selectedNodeId }),
  requestFocus: (title) => set({ focusRequest: { title, ts: Date.now() } }),
  requestFit: () => set((state) => ({ fitRequest: state.fitRequest + 1 })),
}));
