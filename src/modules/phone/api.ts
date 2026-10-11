export interface PhoneStatus {
  configured: boolean;
  calling: boolean;
  reason?: string;
  fromNumber?: string;
  activeCalls?: number;
  maxConcurrentCalls?: number;
}

export interface PhoneCall {
  id: string;
  agentId: string;
  direction: "inbound" | "outbound";
  status: "queued" | "ringing" | "active" | "completed" | "failed" | "no_answer" | "busy" | "rejected";
  trust: "trusted" | "screened";
  fromNumber: string;
  toNumber: string;
  contactName: string | null;
  purpose: string | null;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  endReason: string | null;
  summary: string | null;
  toolCallCount: number;
  turns?: PhoneTurn[];
}

export interface PhoneTurn {
  id: string;
  role: "caller" | "agent";
  text: string;
  offsetMs: number | null;
}

export interface PhoneMessage {
  id: string;
  agentId: string;
  direction: "inbound" | "outbound";
  counterparty: string;
  text: string;
  mediaUrls: string[];
  status: string;
  trust: "trusted" | "screened";
  createdAt: string;
}

export interface PhoneContact {
  id: string;
  name: string;
  number: string;
  callable: boolean;
}

export const AGENTS = [
  { id: "hermes-lisa", label: "Lisa" },
  { id: "hermes-nathan2", label: "Nathan2" },
] as const;

export const IN_PROGRESS: PhoneCall["status"][] = ["queued", "ringing", "active"];

export class PhoneApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/telephony${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new PhoneApiError(payload?.error ?? `Request failed (${response.status})`);
  return payload;
}

export const phoneApi = {
  status: () => request<PhoneStatus>("/status"),
  calls: () => request<{ calls: PhoneCall[] }>("/calls").then((r) => r.calls),
  call: (id: string) => request<{ call: PhoneCall }>(`/calls/${encodeURIComponent(id)}`).then((r) => r.call),
  placeCall: (input: { agent: string; target: string; purpose: string }) =>
    request<{ call: PhoneCall }>("/calls", {
      method: "POST",
      body: JSON.stringify({ ...input, idempotencyKey: crypto.randomUUID() }),
    }).then((r) => r.call),
  hangup: (id: string) => request<{ ok: true }>(`/calls/${encodeURIComponent(id)}/hangup`, { method: "POST" }),
  threads: () => request<{ threads: PhoneMessage[] }>("/messages").then((r) => r.threads),
  thread: (counterparty: string) =>
    request<{ messages: PhoneMessage[] }>(`/messages?counterparty=${encodeURIComponent(counterparty)}`).then((r) => r.messages),
  sendMessage: (input: { agent: string; target: string; text: string }) =>
    request<{ message: PhoneMessage }>("/messages", { method: "POST", body: JSON.stringify(input) }).then((r) => r.message),
  contacts: () => request<{ contacts: PhoneContact[] }>("/contacts").then((r) => r.contacts),
};

export function agentLabel(agentId: string): string {
  return AGENTS.find((a) => a.id === agentId)?.label ?? agentId;
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
