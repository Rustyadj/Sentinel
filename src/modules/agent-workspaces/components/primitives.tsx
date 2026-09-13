"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ApiError, type DisplayState } from "../api";

const STATE_STYLE: Record<DisplayState, { variant: "success" | "warning" | "secondary" | "destructive" | "outline"; label: string }> = {
  RUNNING: { variant: "success", label: "RUNNING" },
  STARTING: { variant: "warning", label: "STARTING" },
  STOPPING: { variant: "warning", label: "STOPPING" },
  PAUSED: { variant: "warning", label: "PAUSED" },
  STOPPED: { variant: "secondary", label: "STOPPED" },
  ERROR: { variant: "destructive", label: "ERROR" },
  ARCHIVED: { variant: "outline", label: "ARCHIVED" },
};

export function StateBadge({ state }: { state: DisplayState }) {
  const style = STATE_STYLE[state] ?? STATE_STYLE.STOPPED;
  return <Badge variant={style.variant}>{style.label}</Badge>;
}

export function formatBytes(value: number | string | null | undefined) {
  const bytes = typeof value === "string" ? Number.parseInt(value, 10) : value;
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}

export function relativeTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const delta = (Date.now() - Date.parse(iso)) / 1000;
  if (delta < 60) return "just now";
  return `${formatDuration(delta)} ago`;
}

/** Small, honest metric: shows "—" rather than inventing a number. */
export function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-[--muted-foreground]">{label}</div>
      <div className="truncate text-sm font-medium tabular-nums">{value}</div>
      {hint ? <div className="truncate text-[11px] text-[--muted-foreground]">{hint}</div> : null}
    </div>
  );
}

export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : String(error);
  const code = error instanceof ApiError ? error.code : null;
  return (
    <div className={cn("rounded-md border border-[--destructive]/40 bg-[--destructive]/10 px-3 py-2 text-xs text-[--destructive]", className)}>
      {message}
      {code ? <span className="ml-2 opacity-70">({code})</span> : null}
    </div>
  );
}

export function EmptyNote({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-6 text-center text-xs text-[--muted-foreground]">{children}</div>;
}

/**
 * Load-on-mount helper with explicit error state and refresh, used by every
 * tab. `key` identifies the request; changing it reloads. The loader is held in
 * a ref so an inline closure does not restart the fetch on every render.
 */
export function useResource<T>(loader: () => Promise<T>, key: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const [settledRequest, setSettledRequest] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  const requestId = `${key}:${nonce}`;

  useEffect(() => { loaderRef.current = loader; });

  useEffect(() => {
    let cancelled = false;
    loaderRef.current()
      .then((result) => { if (!cancelled) { setData(result); setError(null); } })
      .catch((caught) => { if (!cancelled) setError(caught); })
      .finally(() => { if (!cancelled) setSettledRequest(requestId); });
    return () => { cancelled = true; };
  }, [requestId]);

  // Derived rather than stored, so the effect never sets state synchronously.
  const loading = settledRequest !== requestId;

  const refresh = useCallback(async () => { setNonce((value) => value + 1); }, []);
  return { data, error, loading, refresh, setError };
}
