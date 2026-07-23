"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Check, X } from "lucide-react";
import type {
  AttentionAction,
  AttentionItem,
  DataSourceState,
  MissionControlService,
} from "@/lib/mission-control/types";
import { selectAttentionByPriority } from "@/lib/mission-control/selectors";
import { cn } from "@/lib/utils";
import { MissionPanel, UnavailableState } from "./MissionPanel";

const severityStyles = {
  critical: "border-red-400/50 bg-red-500/10 text-red-300",
  high: "border-orange-400/45 bg-orange-500/10 text-orange-300",
  medium: "border-amber-400/40 bg-amber-500/10 text-amber-200",
  low: "border-emerald-400/35 bg-emerald-500/10 text-emerald-300",
};

export function AttentionQueue({
  items,
  service,
  sourceState,
}: {
  items: AttentionItem[];
  service: MissionControlService;
  sourceState: DataSourceState;
}) {
  const [resolvedIds, setResolvedIds] = useState<Set<string>>(() => new Set());
  const visible = useMemo(() => selectAttentionByPriority(items.filter((item) => !resolvedIds.has(item.id))), [items, resolvedIds]);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const act = async (item: AttentionItem, action: AttentionAction) => {
    if (action === "open" || action === "review") {
      window.location.assign(item.href);
      return;
    }
    setError("");
    setPending(`${item.id}:${action}`);
    try {
      const result = await service.resolveAttention(item, action);
      if (result.ok) {
        setResolvedIds((current) => new Set(current).add(item.id));
        setNotice(
          `${item.title} ${action === "approve" ? "approved" : "rejected"}.`,
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The decision could not be saved.");
    } finally {
      setPending(null);
    }
  };

  return (
    <MissionPanel
      title="Attention Queue"
      sourceState={sourceState}
      className="h-full"
      action={
        <span className="rounded bg-violet-500 px-2 py-1 text-[9px] font-semibold text-white">
          {visible.length} open
        </span>
      }
      contentClassName="p-0"
    >
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
      {error ? <p role="alert" className="border-b border-red-400/20 bg-red-500/10 px-4 py-2 text-[10px] text-red-200">{error}</p> : null}
      {visible.length === 0 ? (
        sourceState.state === "unavailable" ? <UnavailableState source={sourceState} emptyMessage="No pending decisions." /> : <div className="flex min-h-44 flex-col items-center justify-center p-8 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/12 text-emerald-300">
            <Check className="h-4 w-4" />
          </span>
          <p className="mt-3 text-[12px] font-medium text-white">
            Queue cleared
          </p>
          <p className="mt-1 text-[10px] text-[#8591a2]">
            There are no remaining decisions that need you.
          </p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-white/[0.07] md:hidden" role="list">
            {visible.map((item) => (
              <li key={item.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span
                      className={cn(
                        "inline-flex rounded border px-2 py-1 text-[8px] font-semibold uppercase",
                        severityStyles[item.severity],
                      )}
                    >
                      {item.severity}
                    </span>
                    <div className="mt-2 text-[11px] font-medium text-white">
                      {item.title}
                    </div>
                    <div className="mt-1 text-[9px] leading-4 text-[#8290a3]">
                      {item.detail}
                    </div>
                  </div>
                  <time className="shrink-0 text-[8px] text-[#738095]">
                    {item.timestamp}
                  </time>
                </div>
                <div className="flex flex-col items-start gap-3 text-[9px] text-[#98a4b5] sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    {item.owner} · {item.source}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {item.actions.map((action) => {
                      const busy = pending === `${item.id}:${action}`;
                      const Icon =
                        action === "approve"
                          ? Check
                          : action === "reject"
                            ? X
                            : ArrowUpRight;
                      return (
                        <button
                          key={action}
                          type="button"
                          disabled={busy}
                          onClick={() => void act(item, action)}
                          aria-label={`${action} ${item.title}`}
                          className={cn(
                            "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-[8px] font-medium capitalize outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60",
                            action === "approve"
                              ? "border-violet-400/60 bg-violet-600 text-white"
                              : "border-white/[0.12] text-[#cbd4df]",
                          )}
                        >
                          <Icon className="h-3 w-3" />
                          {action}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[780px] border-collapse text-left">
              <thead className="border-b border-white/[0.07] text-[9px] uppercase tracking-[0.06em] text-[#718095]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Severity</th>
                  <th className="px-3 py-2.5 font-medium">Item</th>
                  <th className="px-3 py-2.5 font-medium">Owner</th>
                  <th className="px-3 py-2.5 font-medium">Source</th>
                  <th className="px-3 py-2.5 font-medium">Time</th>
                  <th className="px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.07]">
                {visible.map((item) => (
                  <tr key={item.id} className="group hover:bg-white/[0.025]">
                    <td className="px-4 py-3 align-top">
                      <span
                        className={cn(
                          "inline-flex rounded border px-2 py-1 text-[8px] font-semibold uppercase",
                          severityStyles[item.severity],
                        )}
                      >
                        {item.severity}
                      </span>
                    </td>
                    <td className="max-w-[360px] px-3 py-3">
                      <div className="text-[11px] font-medium text-[#f0f3f8]">
                        {item.title}
                      </div>
                      <div className="mt-0.5 truncate text-[9px] text-[#8290a3]">
                        {item.detail}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[10px] text-[#c4ccd8]">
                      {item.owner}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[10px] text-[#a9b4c4]">
                      {item.source}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-[9px] text-[#7d899a]">
                      {item.timestamp}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1.5">
                        {item.actions.map((action) => {
                          const busy = pending === `${item.id}:${action}`;
                          const Icon =
                            action === "approve"
                              ? Check
                              : action === "reject"
                                ? X
                                : ArrowUpRight;
                          return (
                            <button
                              key={action}
                              type="button"
                              disabled={busy}
                              onClick={() => void act(item, action)}
                              aria-label={`${action} ${item.title}`}
                              className={cn(
                                "inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-[9px] font-medium capitalize outline-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-violet-400/60",
                                action === "approve"
                                  ? "border-violet-400/60 bg-violet-600 text-white hover:bg-violet-500"
                                  : "border-white/[0.12] text-[#cbd4df] hover:border-white/25 hover:bg-white/[0.04]",
                              )}
                            >
                              <Icon className="h-3 w-3" />
                              {busy ? "Working" : action}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </MissionPanel>
  );
}
