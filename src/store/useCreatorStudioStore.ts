import { create } from "zustand";
import { persist } from "zustand/middleware";

interface CreatorStudioState {
  activeBrandId: string | null;
  setActiveBrandId: (id: string | null) => void;
}

export const useCreatorStudioStore = create<CreatorStudioState>()(
  persist(
    (set) => ({
      activeBrandId: null,
      setActiveBrandId: (id) => set({ activeBrandId: id }),
    }),
    { name: "creator-studio" }
  )
);
