"use client";

import { useEffect, useState } from "react";

export interface Me {
  id: string;
  name: string | null;
  email: string;
  role: "owner" | "admin" | "operator" | "member" | null;
  guest: boolean;
  canManage: boolean;
  canRunAgents: boolean;
}

let cached: Me | null = null;
let inflight: Promise<Me | null> | null = null;

/** Who is signed in and what they may do. Read once per page load and shared. */
export function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(cached);
  useEffect(() => {
    if (cached) return;
    inflight ??= fetch("/api/people", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as { me: Me }).me : null))
      .catch(() => null);
    let live = true;
    void inflight.then((value) => { cached = value; inflight = null; if (live) setMe(value); });
    return () => { live = false; };
  }, []);
  return me;
}
