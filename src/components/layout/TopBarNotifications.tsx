"use client";

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

interface NotificationEntry {
  id: string;
  action: string;
  entityType: string | null;
  actorType: string;
  actorName: string | null;
  workspaceName: string | null;
  createdAt: string;
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** Recent real activity across the user's accessible workspaces — see
 * /api/notifications: there's no dedicated Notification model, so this
 * surfaces real AuditLog entries rather than a fabricated unread count.
 * Open state is controlled by TopBar so only one top-bar menu is open at
 * a time. */
export function TopBarNotifications({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [entries, setEntries] = useState<NotificationEntry[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/notifications", { signal: controller.signal, cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { notifications?: NotificationEntry[] }) : { notifications: [] }))
      .then((body) => setEntries(body.notifications ?? []))
      .catch(() => { /* keep whatever was showing */ });
    return () => controller.abort();
  }, []);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label="Notifications"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-[#bac4d2] hover:bg-white/[0.05] hover:text-white"
      >
        <Bell className="h-4.5 w-4.5 stroke-[1.5]" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a1420]/98 shadow-2xl">
          <div className="border-b border-white/[0.06] px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-[#66758c]">
            Recent activity
          </div>
          <ul role="listbox" aria-label="Recent activity" className="max-h-80 overflow-y-auto py-1">
            {entries.map((entry) => (
              <li key={entry.id} className="px-3 py-2 text-[11px]">
                <div className="truncate text-[#dbe5f1]">{entry.action.replace(/[._]/g, " ")}</div>
                <div className="mt-0.5 truncate text-[9px] text-[#66758c]">
                  {entry.actorName ?? entry.actorType} · {entry.workspaceName ?? "—"} · {timeAgo(entry.createdAt)}
                </div>
              </li>
            ))}
            {entries.length === 0 ? (
              <li className="px-3 py-3 text-[10px] text-[#718095]">No recent activity in your workspaces</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
