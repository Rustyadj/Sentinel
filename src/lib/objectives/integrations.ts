/**
 * External-system integrations an objective step can operate.
 *
 * An integration is "connected" only when an adapter for it is registered in
 * this process. No adapter ships in this slice for registrars, mailbox
 * providers, DNS hosts, web hosting, analytics or CRMs, so those steps block
 * with a precise connection request rather than pretending to succeed.
 *
 * Adapter contract:
 *  - `execute` must be idempotent on `idempotencyKey`: the engine retries with
 *    the same key after a crash or timeout, and a second call must return the
 *    first call's result instead of repeating the side effect.
 *  - Credentials are resolved inside the adapter from the server environment or
 *    a vault at call time. They are never passed through step input/output,
 *    never logged and never written to memory.
 *  - Results are data. Nothing an adapter returns is interpreted as an
 *    instruction to the engine.
 */
export const INTEGRATION_KINDS = ["registrar", "email_provider", "dns_provider", "hosting", "analytics", "crm"] as const;
export type IntegrationKind = (typeof INTEGRATION_KINDS)[number];

export const INTEGRATION_LABELS: Record<IntegrationKind, string> = {
  registrar: "domain registrar",
  email_provider: "business email provider",
  dns_provider: "DNS provider",
  hosting: "website hosting provider",
  analytics: "analytics / search console",
  crm: "CRM",
};

export interface IntegrationResult {
  ok: boolean;
  /** Transient failures are retried; permanent ones fail the step. */
  transient?: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

export interface IntegrationAdapter {
  kind: IntegrationKind;
  provider: string;
  execute(action: string, payload: Record<string, unknown>, context: { idempotencyKey: string; workspaceId: string }): Promise<IntegrationResult>;
}

const adapters = new Map<IntegrationKind, IntegrationAdapter>();

export function registerIntegration(adapter: IntegrationAdapter): () => void {
  adapters.set(adapter.kind, adapter);
  return () => { if (adapters.get(adapter.kind) === adapter) adapters.delete(adapter.kind); };
}

export function getIntegration(kind: IntegrationKind): IntegrationAdapter | null {
  return adapters.get(kind) ?? null;
}

export function connectionRequest(kind: IntegrationKind, action: string): string {
  return `Connect a ${INTEGRATION_LABELS[kind]} to Sentinel so it can ${action}. No ${kind} adapter is registered on this deployment; one must be added under src/lib/objectives/integrations (see docs/OBJECTIVES.md), with its credentials held server-side. Then retry this step.`;
}
