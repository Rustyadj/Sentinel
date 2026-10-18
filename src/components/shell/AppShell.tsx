"use client";

import { CommandPalette } from "./CommandPalette";
import { ContextInspector } from "./ContextInspector";
import { MobileNav, NavRail } from "./NavRail";
import { TopBar } from "./TopBar";
import { useShellShortcuts } from "./useShellShortcuts";

/**
 * The Sentinel product shell: one rail, one top bar, one full-width surface,
 * and a contextual inspector that only exists when something is selected.
 * Screens own their content entirely.
 */
export function AppShell({ header, title, inspector, children }: {
  /** Surface-specific controls rendered on the left of the top bar. */
  header?: React.ReactNode;
  /** Surface name, shown when the surface has no richer header of its own. */
  title?: React.ReactNode;
  /** Inspector body for the currently selected entity, if the surface has one. */
  inspector?: React.ReactNode;
  children: React.ReactNode;
}) {
  useShellShortcuts();

  return (
    <div className="flex h-full w-full overflow-hidden bg-(--background) text-(--foreground)">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar left={header} title={title} />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-hidden">{children}</main>
          <ContextInspector>{inspector}</ContextInspector>
        </div>
      </div>
      <MobileNav />
      <CommandPalette />
    </div>
  );
}
