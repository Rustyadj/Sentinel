"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Polls `load` on an interval, pausing while the tab is hidden. `intervalMs`
 * may change between renders (fast while a call is live, slow otherwise).
 */
export function usePolling<T>(load: () => Promise<T>, intervalMs: number, enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  return { data, error, refresh };
}
