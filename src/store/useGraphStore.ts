import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ClusterId } from "@/components/neural-lens/categories";
import type { SemanticZoomLevel } from "@/components/neural-lens/types";
import {
  DEFAULT_GLOBE_SETTINGS,
  normalizeGlobeSettings,
  type GlobeSettings,
} from "@/components/neural-lens/graphSettings";

export type GraphTimeWindow = "all" | "7d" | "30d" | "90d";

/**
 * Denormalized snapshot of the node currently selected in the graph canvas —
 * just enough to render a detail card (RightPanel's Graph tab, the graph's own
 * context rail) without every consumer needing direct access to the full
 * LensGraph the canvas is rendering.
 */
export interface GraphNodeSummary {
  id: string;
  label: string;
  type: string;
  val: number;
  hubId?: string;
  clusterId?: ClusterId;
  accent?: boolean;
  active?: boolean;
}

export interface GraphCameraState {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
}

export interface RecentTrace {
  id: string;
  label: string;
  nodeIds: string[];
  capturedAt: number;
}

const RECENT_TRACE_LIMIT = 8;
const TRACE_DEDUPE_WINDOW_MS = 5_000;

function sameNodeSequence(left: RecentTrace, right: RecentTrace): boolean {
  return left.nodeIds.length === right.nodeIds.length
    && left.nodeIds.every((id, index) => id === right.nodeIds[index]);
}

function clampedTraceStep(trace: RecentTrace, index: number): number {
  return Math.max(0, Math.min(index, trace.nodeIds.length - 1));
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
  /** The OS-level cluster the active lens targets, if any. Dims (not
   * removes) everything outside it — see NeuralLensGraph's lensClusterId
   * prop. Persisted so reloading keeps you in the same lens. */
  lensClusterId: ClusterId | null;
  /** When true, Lens Only additionally hides everything outside the lens
   * cluster + its direct neighbors, without recomputing layout. */
  lensOnly: boolean;
  /** Last reported semantic zoom level — persisted so a reload restores
   * roughly the same "how zoomed in was I" context even before the camera
   * state below finishes restoring. */
  zoomLevel: SemanticZoomLevel;
  /** Camera position/target — persisted so reloading the graph doesn't reset
   * to the default overview every time. */
  cameraState: GraphCameraState | null;
  /** How the globe is drawn (density, labels, edges, glow, motion, fog).
   * Persisted: these are preferences, not view state. */
  graphSettings: GlobeSettings;
  /** When true, the camera follows significant live-event activity as it
   * arrives. Defaults OFF every session (not persisted) — the graph should
   * never start spinning the operator's camera on its own. */
  followLive: boolean;
  /** Session-only activity history and replay transport state. These are
   * deliberately excluded from persistence below: a reload starts fresh. */
  recentTraces: RecentTrace[];
  activeTrace: RecentTrace | null;
  traceStepIndex: number;
  tracePlaying: boolean;
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
  setLensCluster: (clusterId: ClusterId | null) => void;
  setLensOnly: (on: boolean) => void;
  setZoomLevel: (level: SemanticZoomLevel) => void;
  setCameraState: (camera: GraphCameraState) => void;
  setGraphSettings: (patch: Partial<GlobeSettings>) => void;
  setFollowLive: (on: boolean) => void;
  addRecentTrace: (trace: RecentTrace) => void;
  seedRecentTraces: (traces: RecentTrace[]) => void;
  selectTrace: (trace: RecentTrace) => void;
  setTracePlaying: (on: boolean) => void;
  restartTrace: () => void;
  stepTrace: (delta: number) => void;
  advanceTrace: () => void;
  exitTrace: () => void;
}

export type GraphStore = GraphUIState & GraphUIActions;

/** Shape actually written to localStorage — must match `partialize` below. */
interface PersistedGraphState {
  lensClusterId: ClusterId | null;
  lensOnly: boolean;
  zoomLevel: SemanticZoomLevel;
  cameraState: GraphCameraState | null;
  selectedNodeId: string | null;
  graphSettings?: Partial<GlobeSettings>;
}

export const useGraphStore = create<GraphStore>()(
  persist(
    (set) => ({
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
      lensClusterId: null,
      lensOnly: false,
      zoomLevel: "galaxy",
      cameraState: null,
      graphSettings: DEFAULT_GLOBE_SETTINGS,
      followLive: false,
      recentTraces: [],
      activeTrace: null,
      traceStepIndex: 0,
      tracePlaying: false,

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
      setLensCluster: (lensClusterId) => set({ lensClusterId }),
      setLensOnly: (lensOnly) => set({ lensOnly }),
      setZoomLevel: (zoomLevel) => set({ zoomLevel }),
      setCameraState: (cameraState) => set({ cameraState }),
      setGraphSettings: (patch) =>
        set((state) => ({
          graphSettings: { ...state.graphSettings, ...patch },
          ...(patch.animate === false ? { tracePlaying: false } : {}),
        })),
      setFollowLive: (followLive) => set({ followLive }),
      addRecentTrace: (trace) =>
        set((state) => {
          if (trace.nodeIds.length < 2) return {};
          const newest = state.recentTraces[0];
          const isNearDuplicate = newest
            && Math.abs(trace.capturedAt - newest.capturedAt) <= TRACE_DEDUPE_WINDOW_MS
            && sameNodeSequence(trace, newest);
          if (isNearDuplicate) return {};
          return { recentTraces: [trace, ...state.recentTraces].slice(0, RECENT_TRACE_LIMIT) };
        }),
      seedRecentTraces: (traces) =>
        set((state) => {
          if (state.recentTraces.length > 0) return {};
          return {
            recentTraces: traces
              .filter((trace) => trace.nodeIds.length >= 2)
              .sort((left, right) => right.capturedAt - left.capturedAt)
              .slice(0, RECENT_TRACE_LIMIT),
          };
        }),
      selectTrace: (activeTrace) =>
        set((state) => ({
          activeTrace,
          traceStepIndex: 0,
          tracePlaying: state.graphSettings.animate && activeTrace.nodeIds.length > 1,
        })),
      setTracePlaying: (tracePlaying) =>
        set((state) => ({
          tracePlaying: Boolean(
            tracePlaying
            && state.graphSettings.animate
            && state.activeTrace
            && state.traceStepIndex < state.activeTrace.nodeIds.length - 1
          ),
        })),
      restartTrace: () =>
        set((state) => state.activeTrace ? { traceStepIndex: 0 } : {}),
      stepTrace: (delta) =>
        set((state) => state.activeTrace
          ? {
              traceStepIndex: clampedTraceStep(state.activeTrace, state.traceStepIndex + delta),
              tracePlaying: false,
            }
          : { tracePlaying: false }),
      advanceTrace: () =>
        set((state) => {
          if (!state.activeTrace) return { tracePlaying: false };
          const nextStep = clampedTraceStep(state.activeTrace, state.traceStepIndex + 1);
          return {
            traceStepIndex: nextStep,
            tracePlaying: nextStep < state.activeTrace.nodeIds.length - 1,
          };
        }),
      exitTrace: () => set({ activeTrace: null, traceStepIndex: 0, tracePlaying: false }),
    }),
    {
      name: "sentinel.neural-lens.view-state",
      // Only the durable "where was I looking / what was I focused on" bits
      // persist — search text, filter chips, replay history/transport, and
      // one-shot request fields are session-scoped and would be actively
      // wrong to restore.
      partialize: (state) => ({
        lensClusterId: state.lensClusterId,
        lensOnly: state.lensOnly,
        zoomLevel: state.zoomLevel,
        cameraState: state.cameraState,
        selectedNodeId: state.selectedNodeId,
        graphSettings: state.graphSettings,
      }),
      // Each layout rewrite invalidates any camera persisted before it: a
      // position framed for the old geometry points at empty space in the new
      // one. v1 was the cluster-of-hubs ring; v2 is the globe (radius 1,000,
      // camera ~2.9k out). Discard just the stale camera on migration, and
      // fill in render settings for clients that predate them.
      version: 2,
      migrate: (persisted, fromVersion) => {
        const state = persisted as PersistedGraphState;
        const graphSettings = normalizeGlobeSettings(state.graphSettings);
        if (fromVersion < 2) return { ...state, cameraState: null, graphSettings };
        return { ...state, graphSettings };
      },
    },
  ),
);
