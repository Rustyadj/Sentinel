"use client";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ModuleTabs } from "./ModuleTabs";
import { RightPanel } from "./RightPanel";
import { useAppStore } from "@/store/useAppStore";

interface AppShellProps {
  children: React.ReactNode;
  /** Set false for full-canvas screens (e.g. Chat) that manage their own panels. */
  rightPanel?: boolean;
}

export function AppShell({ children, rightPanel = true }: AppShellProps) {
  const { rightPanelOpen } = useAppStore();

  return (
    <div className="flex h-full w-full flex-col overflow-hidden">
      <TopBar />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* The rail begins below the brand bar and expands over module content. */}
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden pl-16">
          <ModuleTabs />

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <main className="min-w-0 flex-1 overflow-auto">{children}</main>
            {rightPanel && rightPanelOpen ? (
              <div className="hidden xl:flex">
                <RightPanel />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
