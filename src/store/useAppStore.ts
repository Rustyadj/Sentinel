import { create } from "zustand";
import type { CoreModuleId, Project } from "@/types";

type RightPanelTab = "memory" | "files" | "tasks" | "activity" | "graph";

interface AppState {
  currentModule: CoreModuleId;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  rightPanelTab: RightPanelTab;
  commandBarOpen: boolean;
  activeProject: Project | null;
}

interface AppActions {
  setCurrentModule: (module: CoreModuleId) => void;
  toggleSidebar: () => void;
  setRightPanelOpen: (open: boolean) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setCommandBarOpen: (open: boolean) => void;
  setActiveProject: (project: Project | null) => void;
}

type AppStore = AppState & AppActions;

export const useAppStore = create<AppStore>((set) => ({
  // State
  currentModule: "dashboard",
  sidebarCollapsed: false,
  rightPanelOpen: true,
  rightPanelTab: "activity",
  commandBarOpen: false,
  activeProject: null,

  // Actions
  setCurrentModule: (module) => set({ currentModule: module }),

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),

  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

  setCommandBarOpen: (open) => set({ commandBarOpen: open }),

  setActiveProject: (project) => set({ activeProject: project }),
}));
