import { create } from "zustand";

/** What the contextual inspector is currently showing, if anything. */
export interface InspectorTarget {
  type: "agent" | "project" | "workspace" | "memory" | "knowledge" | "conversation" | "file" | "task" | "artifact";
  id: string;
  label: string;
}

interface ShellState {
  commandPaletteOpen: boolean;
  conversationDrawerOpen: boolean;
  inspector: InspectorTarget | null;
  setCommandPaletteOpen: (open: boolean) => void;
  toggleCommandPalette: () => void;
  setConversationDrawerOpen: (open: boolean) => void;
  toggleConversationDrawer: () => void;
  openInspector: (target: InspectorTarget) => void;
  closeInspector: () => void;
}

/**
 * UI state for the product shell only. Conversation, agent and workspace data
 * stay in their own stores and hooks — this never mirrors domain state.
 */
export const useShellStore = create<ShellState>((set) => ({
  commandPaletteOpen: false,
  conversationDrawerOpen: false,
  inspector: null,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  toggleCommandPalette: () => set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen })),
  setConversationDrawerOpen: (open) => set({ conversationDrawerOpen: open }),
  toggleConversationDrawer: () => set((state) => ({ conversationDrawerOpen: !state.conversationDrawerOpen })),
  openInspector: (target) => set({ inspector: target }),
  closeInspector: () => set({ inspector: null }),
}));
