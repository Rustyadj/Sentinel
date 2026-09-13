"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useShellStore } from "@/store/useShellStore";

/**
 * Keyboard-first navigation. Deliberately narrow: only chords that are not
 * already meaningful in a browser or a text field are claimed, and none fire
 * while the user is typing except the palette itself.
 */
export function useShellShortcuts() {
  const router = useRouter();
  const { toggleCommandPalette, setCommandPaletteOpen, closeInspector, setConversationDrawerOpen } = useShellStore();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.closest("input, textarea, [contenteditable='true']"));

      if (modifier && event.key.toLowerCase() === "k") {
        event.preventDefault();
        toggleCommandPalette();
        return;
      }
      if (event.key === "Escape") {
        setCommandPaletteOpen(false);
        closeInspector();
        return;
      }
      if (typing) return;

      if (modifier && !event.shiftKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        router.push("/chat?new=1");
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "g") {
        event.preventDefault();
        router.push("/graph");
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "w") {
        event.preventDefault();
        router.push("/agent-workspaces");
      }
      if (modifier && event.shiftKey && event.key.toLowerCase() === "o") {
        event.preventDefault();
        setConversationDrawerOpen(true);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [router, toggleCommandPalette, setCommandPaletteOpen, closeInspector, setConversationDrawerOpen]);
}
