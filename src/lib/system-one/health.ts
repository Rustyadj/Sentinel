import type { HealthItem } from "@/lib/mission-control/types";
import { resolveSystemOneConfig } from "./config";
import { getSystemOne } from "./service";
import { getSystemOneSummary } from "./telemetry";

/** One Mission Control health line for System 1: mode, breaker, and what it saved today. */
export async function systemOneHealthItem(userId: string): Promise<HealthItem> {
  const config = resolveSystemOneConfig();
  if (config.mode === "off") {
    return { id: "system-one", label: "System 1 (Jev)", status: "unavailable", value: "Off", detail: "SYSTEM_ONE_MODE=off — routing unchanged" };
  }
  if (!config.apiKey) {
    return { id: "system-one", label: "System 1 (Jev)", status: "down", value: "No key", detail: "Set OPENROUTER_API_KEY or SYSTEM_ONE_API_KEY; every request falls back" };
  }
  const breaker = getSystemOne().service.breakerState();
  const s = await getSystemOneSummary({ windowDays: 1, userId }).catch(() => null);
  const fallback = s?.fallbackRate ?? null;
  const fresh = s?.lastSuccessAt && Date.now() - Date.parse(s.lastSuccessAt) < 15 * 60_000;
  const status: HealthItem["status"] = breaker === "open" ? "down" : !fresh ? "unavailable" : fallback !== null && fallback > 0.2 ? "degraded" : "healthy";
  const value = s
    ? `${config.mode} · p50 ${s.s1.p50 ?? "–"} ms · ${s.system2CallsAvoided} System-2 calls avoided`
    : config.mode;
  const detail = [
    `default Jev · ${config.model} · breaker ${breaker}`,
    !fresh ? "no successful decision in the last 15 minutes; availability unverified" : null,
    fallback !== null ? `fallback ${(fallback * 100).toFixed(0)}%` : "no decisions today",
    s ? s.unpricedDecisions > 0 ? `Jev price unreported for ${s.unpricedDecisions} decisions` : `Jev reported cost $${s.s1.costUsd.toFixed(4)}` : null,
    s?.estCostAvoidedUsd != null ? `est. saved $${s.estCostAvoidedUsd.toFixed(4)}` : s && s.system2CallsAvoided > 0 ? "savings unpriced (no rate card)" : null,
  ].filter(Boolean).join(" · ");
  return { id: "system-one", label: "System 1 (Jev)", status, value, detail };
}
