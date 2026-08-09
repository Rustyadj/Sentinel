"use client";

import { useEffect, useState } from "react";
import { CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface ApprovalSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  createdAt: string;
  requesterUser: { name: string | null; email: string | null } | null;
  requesterAgent: { name: string } | null;
}

/** Real pending approvals for the currently-selected workspace — reuses the
 * existing /api/approvals route rather than a new endpoint. Open state is
 * controlled by TopBar so only one top-bar menu is open at a time. */
export function TopBarApprovals({ workspaceId, open, onOpenChange }: { workspaceId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [approvals, setApprovals] = useState<ApprovalSummary[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    fetch(`/api/approvals?workspaceId=${encodeURIComponent(workspaceId)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (res) => (res.ok ? ((await res.json()) as { approvals?: ApprovalSummary[] }) : { approvals: [] }))
      .then((body) => {
        setApprovals((body.approvals ?? []).filter((a) => a.status === "pending"));
      })
      .catch(() => { /* keep whatever was showing */ });
    return () => controller.abort();
  }, [workspaceId]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label="Approvals"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-[#bac4d2] hover:bg-white/[0.05] hover:text-white"
      >
        <CheckSquare className="h-4.5 w-4.5 stroke-[1.5]" />
        {approvals.length > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[9px] font-semibold text-[#1a1206]">
            {approvals.length}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a1420]/98 shadow-2xl">
          <div className="border-b border-white/[0.06] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[#66758c]">
            Pending approvals
          </div>
          <ul role="listbox" aria-label="Pending approvals" className="max-h-72 overflow-y-auto py-1">
            {approvals.map((approval) => (
              <li key={approval.id}>
                <a
                  href={`/workflows?approval=${approval.id}`}
                  className="block px-3 py-2 text-[11px] hover:bg-white/[0.05]"
                >
                  <div className={cn("truncate text-[#dbe5f1]")}>{approval.title}</div>
                  <div className="mt-0.5 truncate text-[9px] text-[#66758c]">
                    {approval.type} · requested by {approval.requesterAgent?.name ?? approval.requesterUser?.name ?? approval.requesterUser?.email ?? "unknown"}
                  </div>
                </a>
              </li>
            ))}
            {approvals.length === 0 ? (
              <li className="px-3 py-3 text-[10px] text-[#718095]">No pending approvals in this workspace</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
