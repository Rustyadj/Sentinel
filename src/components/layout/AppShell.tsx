"use client";

import { ModuleTabs } from "./ModuleTabs";
import { RightPanel } from "./RightPanel";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { MobileNav, NavRail } from "@/components/shell/NavRail";
import { TopBar } from "@/components/shell/TopBar";
import { useShellShortcuts } from "@/components/shell/useShellShortcuts";
import { useAppStore } from "@/store/useAppStore";

interface AppShellProps {
  children: React.ReactNode;
  /** Set false for full-canvas screens (e.g. Chat) that manage their own panels. */
  rightPanel?: boolean;
}

/**
 * Module screens (agents, tasks, memory, settings…) render inside the same
 * rail, top bar and palette as Chat and Graph. What this wrapper adds is the
 * module's section tabs and the optional context panel.
 */
export function AppShell({ children, rightPanel = true }: AppShellProps) {
  const { rightPanelOpen } = useAppStore();
  useShellShortcuts();

  return (
    <div className="sentinel-app-shell flex h-full w-full overflow-hidden bg-(--background) text-(--foreground)">
      <NavRail />
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar left={<ModuleTabs rightPanel={rightPanel} />} />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-auto bg-(--canvas)">{children}</main>
          {rightPanel && rightPanelOpen ? (
            <div className="animate-slide-in-right hidden xl:flex">
              <RightPanel />
            </div>
          ) : null}
        </div>
      </div>
      <MobileNav />
      <CommandPalette />
    </div>
  );
}
