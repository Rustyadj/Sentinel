"use client";

import React from "react";
import { Rail } from "./Rail";
import { TopBar } from "./TopBar";
import { RightPanel } from "./RightPanel";
import { useAppStore } from "@/store/useAppStore";

export function AppShell({
  children,
  showRightPanel = true,
}: {
  children: React.ReactNode;
  showRightPanel?: boolean;
}) {
  const { rightPanelOpen } = useAppStore();

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-[--background] text-[--foreground]">
      <TopBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Rail />
        <div className="flex min-w-0 flex-1 overflow-hidden">
          <main className="min-w-0 flex-1 overflow-auto">{children}</main>
          {showRightPanel && rightPanelOpen && (
            <div className="hidden shrink-0 xl:flex">
              <RightPanel />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
