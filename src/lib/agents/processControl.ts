import { RemoteContainers, runnerClient } from "@/lib/agent-workspaces/runner/client";
import { ALLOWED_AGENT_IDS, getVpsAgent } from "./registry";

function assertAgentId(agentId: string) {
  if (!ALLOWED_AGENT_IDS.has(agentId)) throw new Error("Agent is not allowlisted");
}

function containerName(agentId: string) {
  assertAgentId(agentId);
  const name = getVpsAgent(agentId)?.containerName;
  if (!name) throw new Error("Agent does not use a Docker runtime");
  return name;
}

// The app container has no Docker socket or CLI by design (see
// docs/SECURITY_REMEDIATION.md §3). Logs go through the workspace runner;
// restart/reload, which mutate host containers, are delegated to a narrow,
// loopback-only, bearer-token-authenticated host service (/opt/host-control
// on the VPS host). Outside production, without a runner, logs use it too.
async function hostControlRequest(path: string, init?: RequestInit) {
  const baseUrl = process.env.HOST_CONTROL_URL;
  const token = process.env.HOST_CONTROL_TOKEN;
  if (!baseUrl || !token) throw new Error("Host control service is not configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...init?.headers, authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function hostControlAction(path: string, init?: RequestInit) {
  const res = await hostControlRequest(path, init);
  const body = (await res.json()) as { ok: boolean; error?: string; message?: string; lines?: string[] };
  if (!res.ok || !body.ok) {
    throw new Error(body.message ?? body.error ?? `Host control request failed (${res.status})`);
  }
  return body;
}

export async function getContainerLogs(agentId: string, lines: number) {
  const name = containerName(agentId);
  const clamped = Math.min(Math.max(lines, 1), 500);
  // Reading logs is a read-only verb the workspace runner serves with its own
  // name/tail validation (runner/containers.ts). In production it is the only
  // path; runnerClient() throws rather than fall back when it is unconfigured.
  const runner = runnerClient();
  if (runner) return new RemoteContainers(runner).logs(name, clamped);
  const body = await hostControlAction(`/containers/${encodeURIComponent(name)}/logs?lines=${clamped}`);
  return { stdout: (body.lines ?? []).join("\n"), stderr: "" };
}

export async function restartContainer(agentId: string) {
  const name = containerName(agentId);
  return hostControlAction(`/containers/${encodeURIComponent(name)}/restart`, { method: "POST" });
}

export async function reloadContainer(agentId: string) {
  const name = containerName(agentId);
  return hostControlAction(`/containers/${encodeURIComponent(name)}/reload`, { method: "POST" });
}
