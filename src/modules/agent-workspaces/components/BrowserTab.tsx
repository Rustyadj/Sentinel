"use client";

import { useEffect, useState } from "react";
import { Camera, Download, ExternalLink, Loader2, MonitorX, Power, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { workspaceApi } from "../api";
import { ErrorNote } from "./primitives";

interface BrowserSession {
  sessionId: string;
  currentUrl: string | null;
}

export function BrowserTab({
  workspaceId,
  browserRuntime,
  canExecute,
}: {
  workspaceId: string;
  browserRuntime: { attached: boolean; provider: string | null; reason?: string };
  canExecute: boolean;
}) {
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [runtime, setRuntime] = useState(browserRuntime);
  const [url, setUrl] = useState("https://example.com");
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => () => {
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
  }, [screenshotUrl]);

  useEffect(() => {
    if (browserRuntime.attached || !browserRuntime.reason?.includes("probe is still running")) return;
    const timer = window.setInterval(() => {
      void workspaceApi.browserStatus(workspaceId).then((status) => {
        setRuntime(status);
        if (status.attached || !status.reason?.includes("probe is still running")) window.clearInterval(timer);
      }).catch(() => undefined);
    }, 500);
    return () => window.clearInterval(timer);
  }, [browserRuntime, workspaceId]);

  if (!runtime.attached) {
    return (
      <div className="rounded-md border border-[--border] px-4 py-8 text-center">
        <MonitorX className="mx-auto mb-3 h-7 w-7 text-[--muted-foreground]" />
        <div className="text-sm font-medium">Browser runtime not attached</div>
        <p className="mx-auto mt-1 max-w-xl text-xs text-[--muted-foreground]">
          {runtime.reason ?? "No usable browser provider is available on this host."}
        </p>
      </div>
    );
  }

  async function run<T>(label: string, operation: () => Promise<T>) {
    setPending(label);
    setError(null);
    try {
      return await operation();
    } catch (caught) {
      setError(caught);
      return undefined;
    } finally {
      setPending(null);
    }
  }

  async function refreshScreenshot(sessionId: string) {
    const blob = await workspaceApi.browserScreenshot(workspaceId, sessionId, true);
    const next = URL.createObjectURL(blob);
    setScreenshotUrl((previous) => {
      if (previous) URL.revokeObjectURL(previous);
      return next;
    });
  }

  async function start() {
    const result = await run("start", () => workspaceApi.browserCreate(workspaceId));
    if (result) setSession(result.session);
  }

  async function navigate() {
    if (!session) return;
    const result = await run("navigate", async () => {
      const navigation = await workspaceApi.browserNavigate(workspaceId, session.sessionId, url);
      await refreshScreenshot(session.sessionId);
      return navigation;
    });
    if (result) {
      setSession(result.session);
      setUrl(result.navigation.url);
    }
  }

  async function download() {
    if (!session?.currentUrl) return;
    await run("download", async () => {
      const result = await workspaceApi.browserDownload(workspaceId, session.sessionId, session.currentUrl!);
      const href = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = result.filename;
      anchor.click();
      URL.revokeObjectURL(href);
    });
  }

  async function close() {
    if (!session) return;
    const closed = await run("close", () => workspaceApi.browserClose(workspaceId, session.sessionId));
    if (closed) {
      setSession(null);
      setScreenshotUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    }
  }

  const busy = Boolean(pending);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-[--border] p-3">
        {!session ? (
          <Button size="sm" disabled={!canExecute || busy} onClick={() => void start()}>
            {pending === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
            Start browser
          </Button>
        ) : (
          <>
            <Input
              className="min-w-[20rem] flex-1 font-mono"
              aria-label="Browser URL"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && !busy && canExecute) void navigate(); }}
            />
            <Button size="sm" disabled={!canExecute || busy || !url.trim()} onClick={() => void navigate()}>
              {pending === "navigate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Open
            </Button>
            <Button size="sm" variant="outline" disabled={busy || !session.currentUrl} onClick={() => void run("screenshot", () => refreshScreenshot(session.sessionId))}>
              <Camera className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" variant="outline" disabled={!canExecute || busy || !session.currentUrl} onClick={() => void download()}>
              <Download className="h-3.5 w-3.5" /> Download URL
            </Button>
            <Button size="sm" variant="ghost" disabled={!canExecute || busy} onClick={() => void close()}>
              <X className="h-3.5 w-3.5" /> Close
            </Button>
          </>
        )}
        <span className="ml-auto text-[11px] text-[--muted-foreground]">{runtime.provider}</span>
      </div>

      {!canExecute ? <p className="text-xs text-[--muted-foreground]">This workspace is not currently writable, so browser mutations are disabled.</p> : null}
      <ErrorNote error={error} />
      {screenshotUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- authenticated blob URL, not an optimizable remote image.
        <img src={screenshotUrl} alt={`Browser screenshot of ${session?.currentUrl ?? url}`} className="w-full rounded-md border border-[--border] bg-white" />
      ) : (
        <div className="rounded-md border border-dashed border-[--border] px-4 py-12 text-center text-xs text-[--muted-foreground]">
          {session ? "Navigate to a page to capture its real screenshot." : "Start an isolated browser session when you are ready."}
        </div>
      )}
    </div>
  );
}
