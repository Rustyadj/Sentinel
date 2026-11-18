"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plug } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyField, Initial, Notice, PrimaryButton, QuietButton, fieldClass, readError } from "./ui";

// Mirrors ProjectAgentView in src/lib/collaboration/project-agents.ts, which
// is server code and must not be imported here.
interface ProjectAgent {
  agentId: string;
  name: string;
  description: string;
  status: "connected" | "disabled" | string;
  owner: { id: string; name: string };
  isYours: boolean;
  canManage: boolean;
  host: string | null;
  lastError: string | null;
}

interface IssuedToken { agentName: string; token: string }

function statusOf(agent: ProjectAgent): { label: string; tone: string } {
  if (agent.status !== "connected") return { label: "Paused", tone: "text-(--muted-foreground)" };
  if (agent.lastError) return { label: "Not answering", tone: "text-(--destructive)" };
  return { label: "Connected", tone: "text-(--status-online)" };
}

/**
 * Agents the people on a project have brought. Each runs on its owner's own
 * server; Sentinel only passes it the messages addressed to it in this
 * project's rooms.
 */
export function ProjectAgents({ projectId, canWrite }: { projectId: string; canWrite: boolean }) {
  const [agents, setAgents] = useState<ProjectAgent[] | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [issued, setIssued] = useState<IssuedToken | null>(null);
  const base = `/api/projects/${projectId}/agents`;

  const load = useCallback(async () => {
    const res = await fetch(base, { cache: "no-store" });
    if (res.ok) setAgents(((await res.json()) as { agents: ProjectAgent[] }).agents);
    else setError(await readError(res, "The agents on this project could not be loaded."));
  }, [base]);

  useEffect(() => {
    // Loading on mount: every setState in here runs after an await, never during the effect itself.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Runs one change, reports a failure in words, and reloads the list either way. */
  async function run<T>(key: string, request: () => Promise<Response>, failure: string, onDone?: (body: T) => void) {
    setBusy(key); setError("");
    try {
      const res = await request();
      if (!res.ok) throw new Error(await readError(res, failure));
      onDone?.((await res.json()) as T);
    } catch (e) {
      setError(e instanceof Error ? e.message : failure);
    } finally {
      await load();
      setBusy("");
    }
  }

  const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  const connect = () => run<{ agent: ProjectAgent; token: string }>(
    "connect", () => fetch(base, json("POST", { url: url.trim() })), "The agent was not connected.",
    ({ agent, token }) => { setUrl(""); setIssued({ agentName: agent.name, token }); },
  );
  const setStatus = (agent: ProjectAgent, status: "connected" | "disabled") =>
    run(agent.agentId, () => fetch(`${base}/${agent.agentId}`, json("PATCH", { status })), "The agent was not changed.");
  const check = (agent: ProjectAgent) => run<{ ok: boolean; error: string | null }>(
    agent.agentId, () => fetch(`${base}/${agent.agentId}`, json("POST", { action: "check" })), "The agent could not be checked.",
    (result) => { if (!result.ok) setError(result.error ?? "The agent did not answer."); },
  );
  const rotate = (agent: ProjectAgent) => run<{ token: string }>(
    agent.agentId, () => fetch(`${base}/${agent.agentId}`, json("POST", { action: "rotate-token" })), "A new token was not issued.",
    ({ token }) => setIssued({ agentName: agent.name, token }),
  );
  const remove = (agent: ProjectAgent) => run(agent.agentId, () => fetch(`${base}/${agent.agentId}`, { method: "DELETE" }), "The agent was not removed.");

  return (
    <section aria-labelledby="project-agents-heading">
      <h2 id="project-agents-heading" className="mb-1 font-display text-[18px] font-semibold tracking-tight">Agents people brought</h2>
      <p className="mb-3 max-w-[65ch] text-[13px] leading-snug text-(--muted-foreground)">
        Each runs on its owner&apos;s own server. Ask one from a room and Sentinel sends it that message, and nothing else from this project.
      </p>

      {error ? <div className="mb-3"><Notice>{error}</Notice></div> : null}

      {issued ? (
        <div className="mb-3 space-y-3 rounded-(--radius-lg) border border-(--border) bg-(--panel) p-4">
          <div>
            <h3 className="text-[14.5px] font-semibold">Token for {issued.agentName}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-(--muted-foreground)">
              Sentinel sends this as <code className="font-mono text-[12px]">Authorization: Bearer</code> with every message. Set your server to require it, so only this project can reach your agent. It is not shown again; issue a new one if you lose it.
            </p>
          </div>
          <CopyField value={issued.token} label={`Token for ${issued.agentName}`} icon={KeyRound} />
          <QuietButton onClick={() => setIssued(null)}>Done</QuietButton>
        </div>
      ) : null}

      <ul className="divide-y divide-(--border) overflow-hidden rounded-(--radius-lg) border border-(--border) bg-(--panel)">
        {agents === null ? <li className="h-14 animate-pulse bg-(--panel) motion-reduce:animate-none" /> : null}
        {agents?.length === 0 ? (
          <li className="px-4 py-5 text-[13.5px] text-(--muted-foreground)">
            None yet.{canWrite ? " Connect one below by the address it publishes its Agent Card at." : ""}
          </li>
        ) : null}
        {agents?.map((agent) => {
          const status = statusOf(agent);
          const working = busy === agent.agentId;
          return (
            <li key={agent.agentId} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
              <Initial name={agent.name} />
              <div className="min-w-0 flex-1 basis-48">
                <p className="truncate text-[14.5px] font-semibold">{agent.name}</p>
                <p className="truncate text-[12.5px] text-(--muted-foreground)">
                  {agent.isYours ? "Yours" : `${agent.owner.name}'s`}{agent.host ? `, on ${agent.host}` : ""}
                </p>
                {agent.isYours && agent.lastError ? <p className="mt-1 text-[12.5px] leading-snug text-(--destructive)">{agent.lastError}</p> : null}
              </div>
              <span className={cn("text-[12.5px] font-medium", status.tone)}>{status.label}</span>
              {agent.canManage ? (
                <div className="flex flex-wrap gap-2">
                  {agent.isYours ? <QuietButton disabled={working} onClick={() => void check(agent)}>Check</QuietButton> : null}
                  {agent.isYours ? <QuietButton disabled={working} onClick={() => { if (window.confirm(`Issue a new token for ${agent.name}? The current one stops working at once.`)) void rotate(agent); }}>New token</QuietButton> : null}
                  {agent.status === "connected"
                    ? <QuietButton disabled={working} onClick={() => void setStatus(agent, "disabled")}>Pause</QuietButton>
                    : agent.isYours ? <QuietButton disabled={working} onClick={() => void setStatus(agent, "connected")}>Resume</QuietButton> : null}
                  <QuietButton danger disabled={working} onClick={() => { if (window.confirm(`Remove ${agent.name} from this project?`)) void remove(agent); }}>Remove</QuietButton>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canWrite ? (
        <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void connect(); }}>
          <input
            type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} maxLength={2000} autoComplete="off"
            aria-label="Address of your agent" placeholder="https://agent.example.com" className={cn(fieldClass, "max-w-sm flex-1 basis-64")}
          />
          <PrimaryButton type="submit" disabled={!url.trim() || busy === "connect"}>
            <Plug aria-hidden className="h-4 w-4" /> {busy === "connect" ? "Connecting…" : "Connect your agent"}
          </PrimaryButton>
        </form>
      ) : null}
    </section>
  );
}
