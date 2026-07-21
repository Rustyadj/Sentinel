"use client";

import { useState, useTransition } from "react";
import { Check, Package, ShieldCheck, Trash2 } from "lucide-react";
import type { ModuleManifestV2 } from "@/lib/modules/manifests";
import { WorkspaceCard } from "@/components/workspace/WorkspaceCard";

export function MarketplaceClient({
  manifests,
  installedModuleIds,
}: {
  manifests: ModuleManifestV2[];
  installedModuleIds: string[];
}) {
  const [installed, setInstalled] = useState(() => new Set(installedModuleIds));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setModule(moduleId: string, shouldInstall: boolean) {
    setError(null);
    startTransition(async () => {
      const response = await fetch(`/api/modules/${moduleId}`, {
        method: shouldInstall ? "PUT" : "DELETE",
        headers: shouldInstall ? { "Content-Type": "application/json" } : undefined,
        body: shouldInstall ? JSON.stringify({ enabled: true }) : undefined,
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Module update failed" }));
        setError(payload.error ?? "Module update failed");
        return;
      }
      setInstalled((current) => {
        const next = new Set(current);
        if (shouldInstall) next.add(moduleId);
        else next.delete(moduleId);
        return next;
      });
    });
  }

  return (
    <>
      {error ? <p role="alert" className="mb-4 rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{error}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        {manifests.map((manifest) => {
          const isInstalled = installed.has(manifest.id);
          return (
            <WorkspaceCard
              key={manifest.id}
              title={manifest.name}
              description={`${manifest.category} · v${manifest.version}`}
              actions={<span className="rounded-full bg-[--muted] px-2 py-1 text-[10px]">{isInstalled ? "Installed" : "Available"}</span>}
            >
              <p className="mb-4 text-xs leading-relaxed text-[--muted-foreground]">{manifest.description}</p>
              <div className="mb-5 rounded-lg border border-[--border] bg-[--background]/40 p-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-medium"><ShieldCheck className="h-3.5 w-3.5 text-[--primary]" />Declared permissions</div>
                <div className="space-y-1">
                  {manifest.declaredPermissions.map((permission) => (
                    <p key={permission.resource} className="font-mono text-[10px] text-[--muted-foreground]">{permission.resource}: {permission.actions.join(", ")}</p>
                  ))}
                </div>
              </div>
              <button
                disabled={pending}
                onClick={() => setModule(manifest.id, !isInstalled)}
                className={`inline-flex h-9 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-medium disabled:opacity-50 ${isInstalled ? "border border-[--border] bg-[--muted] text-[--foreground]" : "bg-[--primary] text-[--primary-foreground]"}`}
              >
                {isInstalled ? <><Trash2 className="h-4 w-4" />Uninstall</> : <><Package className="h-4 w-4" />Install</>}
              </button>
              {isInstalled ? <p className="mt-2 flex items-center justify-center gap-1 text-[10px] text-emerald-400"><Check className="h-3 w-3" />Manifest v2 registered</p> : null}
            </WorkspaceCard>
          );
        })}
      </div>
    </>
  );
}
