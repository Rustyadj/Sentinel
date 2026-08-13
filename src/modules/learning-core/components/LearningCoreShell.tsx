"use client";

import Link from "next/link";
import { Sparkles, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LearningCoreSection } from "../types";

export function LearningCoreShell({
  sections,
  activeSection,
  children,
}: {
  sections: LearningCoreSection[];
  activeSection: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex overflow-hidden">
      <div className="w-56 flex flex-col h-full bg-[--sidebar] border-r border-[--sidebar-border] overflow-hidden shrink-0">
        <div className="px-3 py-3 border-b border-[--sidebar-border]">
          <span className="text-xs font-semibold text-[--foreground] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[--primary]" /> Learning Core
          </span>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sections.map((section) => {
            const isActive = section.id === activeSection;
            const disabled = section.status === "planned";
            return (
              <Link
                key={section.id}
                href={disabled ? "#" : `/learning-core/${section.id}`}
                aria-disabled={disabled}
                className={cn(
                  "flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-xs transition-colors",
                  isActive
                    ? "bg-[--primary]/15 text-[--primary]"
                    : disabled
                      ? "text-[--muted-foreground]/50 cursor-default pointer-events-none"
                      : "text-[--muted-foreground] hover:bg-white/5 hover:text-[--foreground]"
                )}
              >
                <span className="truncate">{section.label}</span>
                {disabled && <Lock className="w-3 h-3 shrink-0" />}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
    </div>
  );
}
