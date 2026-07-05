import Link from "next/link";
import { Shield, Building2, Wand2, Megaphone, DollarSign, type LucideIcon } from "lucide-react";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WORKSPACES } from "@/lib/workspaces";

const ICON_MAP: Record<string, LucideIcon> = {
  Shield, Building2, Wand2, Megaphone, DollarSign,
};

export default function WorkspacesPage() {
  return (
    <WorkspaceShell>
      <WorkspaceHeader
        title="Workspaces"
        description="AI-powered domain modules — plug in what you need."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {WORKSPACES.map((ws) => {
          const Icon = ICON_MAP[ws.icon] ?? Shield;
          return (
            <div key={ws.id} className="relative">
              {ws.enabled ? (
                <Link
                  href={ws.route}
                  className="block rounded-xl border border-[--canvas-card-border] bg-[--canvas-card] p-5 hover:border-[--primary]/40 transition-colors group"
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: ws.color + "22" }}
                    >
                      <Icon className="w-5 h-5" style={{ color: ws.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold text-[--canvas-card-foreground] group-hover:text-white transition-colors">
                          {ws.label}
                        </h2>
                      </div>
                      <p className="text-xs text-[--muted-foreground] mt-1 leading-relaxed">
                        {ws.description}
                      </p>
                      <p className="text-xs mt-3" style={{ color: ws.color }}>
                        {ws.subnav.length} modules →
                      </p>
                    </div>
                  </div>
                </Link>
              ) : (
                <div className="rounded-xl border border-[--canvas-card-border] bg-[--canvas-card] p-5 opacity-50 cursor-not-allowed">
                  <div className="flex items-start gap-4">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ backgroundColor: ws.color + "22" }}
                    >
                      <Icon className="w-5 h-5" style={{ color: ws.color }} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold text-[--canvas-card-foreground]">
                          {ws.label}
                        </h2>
                        {ws.badge && (
                          <span className="text-[10px] border border-[--canvas-card-border] rounded px-1.5 py-0.5 text-[--muted-foreground]">
                            {ws.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[--muted-foreground] mt-1 leading-relaxed">
                        {ws.description}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </WorkspaceShell>
  );
}
