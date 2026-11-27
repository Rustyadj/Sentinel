"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { WorkforceSnapshot } from "@/lib/workforce/snapshot";

export function WorkforceConnections({ data, onChange }: { data: WorkforceSnapshot; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [bindingId, setBindingId] = useState("");
  const binding = data.credentialBindings.find((candidate) => candidate.id === bindingId);

  async function refreshDiscovery(id: string) {
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch(`/api/bots/catalog/${encodeURIComponent(id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "refresh" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Discovery failed.");
      setStatus(body.status === "connected" ? `Found ${body.tools} tools.` : body.lastError ?? "Discovery failed.");
      onChange();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Discovery failed.");
    } finally {
      setBusy(false);
    }
  }

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/bots/catalog", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: data.workspace.id,
          name: form.get("name"), url: binding?.endpoint ?? form.get("url"), credentialBindingId: binding?.id,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not register the MCP connection.");
      const server = body.server;
      setStatus(server.status === "connected"
        ? `${server.name} connected. Found ${server.tools} tools.`
        : `${server.name} registered. Discovery status is ${server.status}. Open the MCP catalog to inspect the connection.`);
      onChange();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "MCP registration failed.");
    } finally {
      setBusy(false);
    }
  }

  return <Card>
    <CardHeader><CardTitle>Integration connections</CardTitle></CardHeader>
    <CardContent className="space-y-3 text-sm">
      {!data.connections.length && <p className="text-(--muted-foreground)">No MCP servers registered in this workspace.</p>}
      <ul className="space-y-2">{data.connections.map((connection) => <li className="border-b border-(--border) pb-2" key={connection.id}>
        <p><strong>{connection.name}</strong> · {connection.enabled ? connection.status.replaceAll("_", " ") : "Disabled"}{connection.status === "connected" ? ` · ${connection.toolCount} tools` : ""}</p>
        <p className="text-xs text-(--muted-foreground)">{connection.authenticated ? "Deployment credential" : "Unauthenticated endpoint"}{connection.lastDiscoveredAt ? ` · Last discovery ${new Date(connection.lastDiscoveredAt).toLocaleDateString()}` : ""}</p>
        {connection.lastError && <p className="text-xs text-(--muted-foreground)">{connection.lastError}</p>}
        {data.access.plan && <Button disabled={busy} type="button" variant="ghost" size="sm" onClick={() => void refreshDiscovery(connection.id)}>Refresh tools</Button>}
        {connection.capabilityTags.length > 0 && <p className="text-xs text-(--muted-foreground)">{connection.capabilityTags.join(", ")}</p>}
      </li>)}</ul>
      {data.access.plan && <details>
        <summary className="cursor-pointer font-medium">Connect an MCP server</summary>
        <form className="mt-3" onSubmit={connect}>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">Connection name<Input name="name" required maxLength={80} /></label>
            {data.credentialBindings.length > 0 && <label className="grid gap-1">Authentication<select className="rounded-md border border-(--border) bg-(--background) px-2 py-1" value={bindingId} onChange={(event) => setBindingId(event.target.value)}>
              <option value="">Public endpoint</option>
              {data.credentialBindings.map((item) => <option key={item.id} value={item.id} disabled={!item.configured}>{item.label}{item.configured ? "" : " (credential missing)"}</option>)}
            </select></label>}
            <label className="grid gap-1">MCP endpoint<Input key={binding?.id ?? "public"} defaultValue={binding?.endpoint} readOnly={!!binding} name="url" type="url" placeholder="https://example.com/mcp" required maxLength={2048} /></label>
            <div className="sm:col-span-2"><Button size="sm">{busy ? "Discovering tools…" : "Connect and discover"}</Button></div>
          </fieldset>
        </form>
      </details>}
      {status && <p role="status">{status}</p>}
      <Button asChild variant="outline" size="sm"><Link href="/bots">Manage MCP catalog</Link></Button>
    </CardContent>
  </Card>;
}
