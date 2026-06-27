import { create } from "zustand";
import { persist } from "zustand/middleware";

interface KeyState {
  anthropicKey: string;
  openaiKey: string;
  openrouterKey: string;
  setAnthropicKey: (key: string) => void;
  setOpenAIKey: (key: string) => void;
  setOpenRouterKey: (key: string) => void;
  clearAll: () => void;
}

export const useKeyStore = create<KeyState>()(
  persist(
    (set) => ({
      anthropicKey: "",
      openaiKey: "",
      openrouterKey: "",
      setAnthropicKey: (key) => set({ anthropicKey: key }),
      setOpenAIKey: (key) => set({ openaiKey: key }),
      setOpenRouterKey: (key) => set({ openrouterKey: key }),
      clearAll: () =>
        set({ anthropicKey: "", openaiKey: "", openrouterKey: "" }),
    }),
    { name: "hermes-api-keys" }
  )
);

export function maskKey(key: string): string {
  if (!key || key.length < 10) return key || "Not configured";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
