"use client";

import { Search } from "lucide-react";
import { useSession } from "next-auth/react";
import { useShellStore } from "@/store/useShellStore";
import { IconButton } from "./primitives";

/**
 * A quiet top bar: the surface identity and its context on the left, global
 * search and profile on the right. Screens contribute their own controls
 * through `left` — the shell does not guess what they need.
 */
export function TopBar({ left }: { left?: React.ReactNode }) {
  const { setCommandPaletteOpen } = useShellStore();
  const { data: session } = useSession();
  const name = session?.user?.name ?? session?.user?.email ?? null;
  const initial = name?.trim()?.charAt(0)?.toUpperCase() ?? "?";

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 px-4">
      <div className="flex min-w-0 flex-1 items-center gap-2">{left}</div>

      <button
        type="button"
        onClick={() => setCommandPaletteOpen(true)}
        className="hidden items-center gap-2 rounded-lg bg-[--muted] px-3 py-1.5 text-[13px] text-[--muted-foreground] transition-colors hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] sm:flex"
      >
        <Search className="h-3.5 w-3.5" />
        <span>Search</span>
        <kbd className="rounded bg-[--card] px-1.5 py-0.5 text-[11px] text-[--muted-foreground]">⌘K</kbd>
      </button>
      <IconButton label="Search" className="sm:hidden" onClick={() => setCommandPaletteOpen(true)}>
        <Search className="h-4 w-4" />
      </IconButton>

      <span
        title={name ?? "Signed out"}
        aria-label={name ? `Signed in as ${name}` : "Signed out"}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-[--muted] text-[13px] text-[--foreground]"
      >
        {initial}
      </span>
    </header>
  );
}
