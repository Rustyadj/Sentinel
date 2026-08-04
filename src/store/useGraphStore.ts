import { create } from "zustand";

export type GraphTimeWindow = "all" | "7d" | "30d" | "90d";

/**
 * Denormalized snapshot of the node currently selected in the graph canvas —
 * just enough to render a detail card (RightPanel's Graph tab, the floating
 * NeuralLensInspector) without every consumer needing direct access to the
 * full LensGraph the canvas is rendering.
 */
export interface GraphNodeSummary {
  id: string;
  label: string;
  type: string;
  val: number;
  hubId?: string;
  accent?: boolean;
  active?: boolean;
}

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
  /** Denormalized detail for whichever node selectedNodeId points at — set
   * alongside selectedNodeId by whoever owns the canvas (e.g. NeuralLens). */
  selectedNode: GraphNodeSummary | null;
  /** Type chips available to filter by in the graph currently on screen —
   * populated by the canvas (its type set depends on demo vs. live data),
   * consumed by any compact filter UI (e.g. RightPanel's Graph tab). */
  availableTypes: string[];
  /** One-shot request to focus a node by title (from chat references). */
  focusRequest: { title: string; ts: number } | null;
  /** Incrementing counter — KnowledgeGraph fits the view when it changes. */
  fitRequest: number;
  /** Titles that should stay lit regardless of hover/click focus or live-event
   * pulses — e.g. every agent currently selected into the active chat. Set
   * wholesale (not toggled individually) since the owner (ChatHeader's agent
   * picker) already tracks its own selection state. */
  pinnedTitles: string[];
}

interface GraphUIActions {
  setSearch: (search: string) => void;
  toggleType: (type: string) => void;
  setTypes: (types: string[]) => void;
  clearTypes: () => void;
  setFocusMode: (on: boolean) => void;
  setClustering: (on: boolean) => void;
  setTimeWindow: (window: GraphTimeWindow) => void;
  selectNode: (id: string | null) => void;
  setSelectedNode: (node: GraphNodeSummary | null) => void;
  setAvailableTypes: (types: string[]) => void;
  requestFocus: (title: string) => void;
  requestFit: () => void;
  setPinnedTitles: (titles: string[]) => void;
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
  selectedNode: null,
  availableTypes: [],
  focusRequest: null,
  fitRequest: 0,
  pinnedTitles: [],

  setSearch: (search) => set({ search }),
  toggleType: (type) =>
    set((state) => {
      const next = new Set(state.activeTypes);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return { activeTypes: next };
    }),
  setTypes: (types) => set({ activeTypes: new Set(types) }),
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
  setSelectedNode: (selectedNode) =>
    set({ selectedNode, selectedNodeId: selectedNode?.id ?? null }),
  setAvailableTypes: (availableTypes) => set({ availableTypes }),
  requestFocus: (title) => set({ focusRequest: { title, ts: Date.now() } }),
  requestFit: () => set((state) => ({ fitRequest: state.fitRequest + 1 })),
  setPinnedTitles: (pinnedTitles) => set({ pinnedTitles }),
}));
