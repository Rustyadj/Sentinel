"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  Loader2,
  Play,
  Copy,
  Check,
  ChevronDown,
  Link2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StepStatus = "pass" | "fail" | "skipped";

interface DiagnosticStep {
  id: string;
  label: string;
  status: StepStatus;
  detail: string;
  durationMs: number;
  request?: { method: string; url: string };
  statusCode?: number;
  body?: string;
  logs?: string[];
}

interface DiagnosticReport {
  ok: boolean;
  origin: string;
  endpoint: string;
  ranAt: string;
  steps: DiagnosticStep[];
  fixPrompt?: string;
}

/** Shown before a run so the chain is legible even with no result yet. */
const CHAIN: { id: string; label: string; hint: string }[] = [
  { id: "https", label: "HTTPS reachability", hint: "Public origin answers over TLS" },
  { id: "endpoint", label: "/mcp endpoint challenge", hint: "401 + resource_metadata" },
  { id: "oauth_discovery", label: "OAuth discovery", hint: "Metadata present and consistent" },
  { id: "initialize", label: "MCP Initialize", hint: "Protocol handshake accepted" },
  { id: "tools_list", label: "tools/list", hint: "Tools advertised to the client" },
  { id: "tool_call", label: "Tool invocation", hint: "Read-only tool executes" },
];

const STATUS_STYLES: Record<StepStatus, { icon: typeof CheckCircle2; className: string; dot: string; label: string }> = {
  pass: { icon: CheckCircle2, className: "text-[#10b981]", dot: "bg-[#10b981]", label: "Pass" },
  fail: { icon: XCircle, className: "text-[#ef4444]", dot: "bg-[#ef4444]", label: "Fail" },
  skipped: { icon: MinusCircle, className: "text-[--muted-foreground]", dot: "bg-[--muted-foreground]", label: "Skipped" },
};

function CopyButton({ text, label, variant = "outline" }: { text: string; label: string; variant?: "outline" | "default" }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API is unavailable over plain HTTP; fall back so the button
      // is never a dead control.
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
  }, [text]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button size="sm" variant={variant} onClick={copy} className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      <span className="tabular-nums">{copied ? "Copied" : label}</span>
    </Button>
  );
}

function StepRow({ step, fallback }: { step?: DiagnosticStep; fallback: { label: string; hint: string } }) {
  const [open, setOpen] = useState(false);
  const status = step?.status;
  const style = status ? STATUS_STYLES[status] : null;
  const Icon = style?.icon;
  const hasDetail = Boolean(step && (step.body || step.logs?.length || step.request));

  return (
    <div className="border-b border-[--border] last:border-b-0">
      <button
        type="button"
        onClick={() => hasDetail && setOpen((value) => !value)}
        disabled={!hasDetail}
        aria-expanded={hasDetail ? open : undefined}
        className={cn(
          "w-full flex items-start gap-3 px-3 py-2.5 text-left transition-colors rounded-md",
          hasDetail ? "hover:bg-[--accent] cursor-pointer" : "cursor-default",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
        )}
      >
        <span className="mt-0.5 shrink-0">
          {Icon && style ? (
            <Icon className={cn("h-4 w-4", style.className)} aria-hidden />
          ) : (
            <span className="block h-4 w-4 rounded-full border border-dashed border-[--border]" aria-hidden />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-[--foreground]">{step?.label ?? fallback.label}</span>
            {step?.statusCode !== undefined && (
              <span className="font-mono text-[10px] text-[--muted-foreground]">HTTP {step.statusCode}</span>
            )}
            {step && (
              <span className="font-mono text-[10px] text-[--muted-foreground] tabular-nums">{step.durationMs}ms</span>
            )}
          </span>
          <span className="mt-0.5 block text-xs text-[--muted-foreground]">
            {step?.detail ?? fallback.hint}
          </span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {style && (
            <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", style.className)}>
              {style.label}
            </Badge>
          )}
          {hasDetail && (
            <ChevronDown className={cn("h-3.5 w-3.5 text-[--muted-foreground] transition-transform", open && "rotate-180")} aria-hidden />
          )}
        </span>
      </button>

      {open && step && (
        <div className="px-3 pb-3 pl-10 space-y-2">
          {step.request && (
            <div className="font-mono text-[11px] text-[--muted-foreground] break-all">
              {step.request.method} {step.request.url}
            </div>
          )}
          {step.logs?.length ? (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-1">Sanitized logs</div>
              <pre className="rounded-md border border-[--border] bg-[--muted]/30 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-[--foreground]/85">
                {step.logs.join("\n")}
              </pre>
            </div>
          ) : null}
          {step.body ? (
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-1">Response body</div>
              <pre className="max-h-64 overflow-auto rounded-md border border-[--border] bg-[--muted]/30 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-[--foreground]/85">
                {step.body}
              </pre>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * The permanent ChatGPT integration panel.
 *
 * Every step ChatGPT walks through when it adds Sentinel as a connector is run
 * against the real public origin and reported here, so a failed connection can
 * be read off one screen instead of reconstructed from server logs.
 */
export function McpDiagnosticsPanel() {
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The origin is only knowable in the browser, and it never changes, so it is
  // read as an external value rather than synced into state by an effect.
  const endpoint = useSyncExternalStore(
    () => () => {},
    () => `${window.location.origin}/api/mcp`,
    () => "",
  );

  const run = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const response = await fetch("/api/integrations/mcp/diagnostics", { method: "POST" });
      const payload = await response.json().catch(() => null) as (DiagnosticReport & { error?: string }) | null;
      if (!response.ok || !payload || payload.error) {
        setError(payload?.error ?? `Diagnostics request failed with ${response.status}.`);
        return;
      }
      setReport(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Diagnostics request could not be sent.");
    } finally {
      setRunning(false);
    }
  }, []);

  const byId = useMemo(() => new Map((report?.steps ?? []).map((step) => [step.id, step])), [report]);
  const failures = report?.steps.filter((step) => step.status === "fail").length ?? 0;
  const connectorUrl = report?.endpoint ?? endpoint;

  return (
    <div className="space-y-5 max-w-3xl">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-[--foreground]">MCP Setup &amp; Diagnostics</h2>
        <p className="text-sm text-[--muted-foreground]">
          The full ChatGPT connector chain, probed against this deployment&apos;s public origin — the same path an
          external client takes, not an in-process shortcut.
        </p>
      </header>

      {/* Setup */}
      <section className="rounded-lg border border-[--border] bg-[--card] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Link2 className="h-4 w-4 text-[--primary]" aria-hidden />
          <h3 className="text-sm font-semibold text-[--foreground]">Connector URL</h3>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <code className="flex-1 min-w-0 rounded-md border border-[--border] bg-[--muted]/30 px-2.5 py-1.5 font-mono text-xs break-all text-[--foreground]">
            {connectorUrl || "…"}
          </code>
          {connectorUrl && <CopyButton text={connectorUrl} label="Copy URL" />}
        </div>
        <p className="text-xs text-[--muted-foreground]">
          In ChatGPT: Settings → Connectors → Add custom connector, paste this URL, and authorize. Sentinel registers
          the client automatically over OAuth (dynamic registration, PKCE S256); no client secret is needed.
        </p>
      </section>

      {/* Run */}
      <section className="rounded-lg border border-[--border] bg-[--card]">
        <div className="flex items-center justify-between gap-3 flex-wrap border-b border-[--border] p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[--primary]" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold text-[--foreground]">ChatGPT compatibility test</h3>
              <p className="text-xs text-[--muted-foreground]">
                {report
                  ? `Last run ${new Date(report.ranAt).toLocaleString()} — ${failures === 0 ? "all steps green" : `${failures} failing step${failures === 1 ? "" : "s"}`}.`
                  : "Six steps, read-only. Nothing is created or modified."}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <Badge
                variant="outline"
                className={cn("text-[10px] uppercase tracking-wide", report.ok ? "text-[#10b981]" : "text-[#ef4444]")}
              >
                {report.ok ? "Connector ready" : "Connector blocked"}
              </Badge>
            )}
            <Button onClick={run} disabled={running} className="gap-2 min-w-[210px] justify-center">
              {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
              {running ? "Running…" : "Run ChatGPT Compatibility Test"}
            </Button>
          </div>
        </div>

        {error && (
          <div className="border-b border-[--border] bg-[#ef4444]/10 px-4 py-3">
            <p className="text-sm text-[#ef4444]">{error}</p>
            <Button size="sm" variant="outline" className="mt-2" onClick={run} disabled={running}>
              Retry
            </Button>
          </div>
        )}

        <div className="p-1">
          {CHAIN.map((item) => (
            <StepRow key={item.id} step={byId.get(item.id)} fallback={item} />
          ))}
        </div>
      </section>

      {/* Remediation */}
      {report && !report.ok && report.fixPrompt && (
        <section className="rounded-lg border border-[#ef4444]/40 bg-[#ef4444]/5 p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-[--foreground]">Fix prompt</h3>
            <p className="text-xs text-[--muted-foreground]">
              Status codes, response bodies, and sanitized logs for every failing step, with the relevant source paths.
              Tokens and secrets are redacted server-side. Paste it into Claude Code or Codex.
            </p>
          </div>
          <pre className="max-h-72 overflow-auto rounded-md border border-[--border] bg-[--muted]/30 p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all text-[--foreground]/85">
            {report.fixPrompt}
          </pre>
          <CopyButton text={report.fixPrompt} label="Copy Fix Prompt" variant="default" />
        </section>
      )}
    </div>
  );
}
