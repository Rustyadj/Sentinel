"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { getActiveWorkspace } from "@/lib/workspaces";

interface WorkspaceHeaderProps {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  accent?: string;
  className?: string;
  /** Show a back arrow that returns to the previous view. */
  showBack?: boolean;
  /** Render the active workspace's subnav as a horizontal tab row. */
  showTabs?: boolean;
}

export function WorkspaceHeader({
  title,
  description,
  actions,
  accent,
  className,
  showBack = true,
  showTabs = true,
}: WorkspaceHeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const workspace = getActiveWorkspace(pathname);
  const tabs = showTabs ? workspace?.subnav ?? [] : [];

  return (
    <div className={cn("mb-6", className)}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {showBack && (
            <button
              onClick={() => router.back()}
              className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg border border-[--canvas-card-border] text-[--muted-foreground] hover:text-[--canvas-foreground] hover:bg-[--canvas-card] transition-colors"
              title="Back"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          {accent && !showBack && (
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: accent }}
            />
          )}
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-[--canvas-foreground] leading-tight">
              {title}
            </h1>
            {description && (
              <p className="text-sm text-[--canvas-muted] mt-0.5">{description}</p>
            )}
          </div>
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        )}
      </div>

      {tabs.length > 0 && (
        <div className="mt-4 -mx-1 flex items-center gap-1 overflow-x-auto border-b border-[--canvas-card-border] pb-px">
          {tabs.map((tab) => {
            const active = pathname === tab.href;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={cn(
                  "relative shrink-0 px-3 py-2 text-sm whitespace-nowrap transition-colors",
                  active
                    ? "text-[--canvas-foreground] font-medium"
                    : "text-[--muted-foreground] hover:text-[--canvas-foreground]"
                )}
              >
                {tab.label}
                {active && (
                  <span
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full"
                    style={{ backgroundColor: workspace?.color ?? "var(--primary)" }}
                  />
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
