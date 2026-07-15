"use client";

import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { RightPanel } from "./RightPanel";
import { StatusBar } from "./StatusBar";
import { useAppStore } from "@/store/useAppStore";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { rightPanelOpen } = useAppStore();

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-[--background]">
      {/* Full-width command bar */}
      <TopBar />

      {/* Body: hover-expand rail overlays the content, content offset by collapsed rail width */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        <Rail />

        <div className="flex flex-1 min-w-0 overflow-hidden pl-14">
          <main className="flex-1 overflow-auto min-w-0">{children}</main>
          {rightPanelOpen && (
            <div className="hidden xl:flex">
              <RightPanel />
            </div>
          )}
        </div>
      </div>

      {/* Persistent system status strip */}
      <StatusBar />
    </div>
  );
}
