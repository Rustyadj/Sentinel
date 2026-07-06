"use client";

import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { RightPanel } from "./RightPanel";
import { useAppStore } from "@/store/useAppStore";

export function AppShell({
  children,
  showRightPanel = true,
}: {
  children: React.ReactNode;
  /** Pages with their own right-hand pane (e.g. home) can opt out */
  showRightPanel?: boolean;
}) {
  const { rightPanelOpen } = useAppStore();

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Hover-expand rail — fixed, overlays content */}
      <Rail />

      {/* Main area — offset by the collapsed rail width (w-14 = 56px) */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden pl-14">
        <TopBar />

        <div className="flex flex-1 min-h-0 overflow-hidden">
          <main className="flex-1 overflow-auto min-w-0">{children}</main>
          {showRightPanel && rightPanelOpen && (
            <div className="hidden xl:flex">
              <RightPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
