import { MCP_ACCEPT } from "@/lib/integrations/mcp-http";

/**
 * End-to-end probe of the ChatGPT connector chain.
 *
 * Every step ChatGPT performs when it connects to Sentinel is run here, in the
 * same order and over the same public HTTPS origin an external client would
 * use — not through in-process calls. A green chain therefore means ChatGPT
 * itself would succeed; an in-process shortcut would hide exactly the failures
 * (TLS, proxy routing, forwarded-host discovery) this page exists to surface.
 */

export const MCP_DIAGNOSTIC_STEPS = [
  "https",
  "endpoint",
  "oauth_discovery",
  "initialize",
  "tools_list",
  "tool_call",
] as const;

export type McpDiagnosticStepId = (typeof MCP_DIAGNOSTIC_STEPS)[number];

export interface McpDiagnosticStep {
  id: McpDiagnosticStepId;
  label: string;
  status: "pass" | "fail" | "skipped";
  detail: string;
  durationMs: number;
  request?: { method: string; url: string };
  statusCode?: number;
  /** Response body, truncated and sanitized. Present on failure. */
  body?: string;
  /** Sanitized server-side notes: headers seen, redirects, parse errors. */
  logs?: string[];
}

export interface McpDiagnosticReport {
  ok: boolean;
  origin: string;
  endpoint: string;
  ranAt: string;
  steps: McpDiagnosticStep[];
  /** Ready-to-paste remediation prompt. Only set when the chain failed. */
  fixPrompt?: string;
}

const BODY_LIMIT = 2000;
const STEP_TIMEOUT_MS = 12_000;

/**
 * Strip anything that must never reach a clipboard, a screen, or a chat log.
 *
 * The whole point of the Copy Fix Prompt button is that the output gets pasted
 * into another agent, so the redaction happens here — before the text is ever
 * put in a response — rather than in the UI where a future caller could miss it.
 */
export function sanitize(text: string): string {
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/("?(?:access_token|refresh_token|client_secret|code|code_verifier|authorization|token|password|secret|api[_-]?key)"?\s*[:=]\s*"?)[^"'\s,&}]+/gi, "$1[redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");
}

function truncate(text: string): string {
  return text.length > BODY_LIMIT ? `${text.slice(0, BODY_LIMIT)}\n…[truncated ${text.length - BODY_LIMIT} chars]` : text;
}

async function readBody(response: Response): Promise<string> {
  const raw = await response.text().catch(() => "");
  return truncate(sanitize(raw));
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: "no-store", redirect: "manual" });
  } finally {
    clearTimeout(timer);
  }
}

function headerLogs(response: Response, names: string[]): string[] {
  return names
    .map((name) => [name, response.headers.get(name)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    .map(([name, value]) => `${name}: ${sanitize(value)}`);
}

interface RunOptions {
  origin: string;
  /** Short-lived diagnostic access token, bound to `${origin}/api/mcp`. */
  accessToken: string;
}

type Runner = () => Promise<Omit<McpDiagnosticStep, "id" | "label" | "durationMs">>;

async function timed(id: McpDiagnosticStepId, label: string, run: Runner): Promise<McpDiagnosticStep> {
  const started = Date.now();
  try {
    const result = await run();
    return { id, label, durationMs: Date.now() - started, ...result };
  } catch (error) {
    const message = error instanceof Error
      ? error.name === "AbortError" ? `No response within ${STEP_TIMEOUT_MS / 1000}s.` : error.message
      : "Unknown error.";
    return { id, label, status: "fail", detail: sanitize(message), durationMs: Date.now() - started };
  }
}

function rpc(method: string, params: Record<string, unknown>, id: number) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

/**
 * Parse an MCP response body that may arrive as JSON or as an SSE stream —
 * the Streamable HTTP transport is free to choose either, and a client that
 * only understands one of them is the single most common connector failure.
 */
function parseMcpBody(contentType: string | null, raw: string): { payload: unknown; note: string } {
  if (contentType?.includes("text/event-stream")) {
    const data = raw.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("");
    try { return { payload: JSON.parse(data), note: "Parsed SSE frame." }; }
    catch { return { payload: null, note: "SSE frame present but not valid JSON." }; }
  }
  try { return { payload: JSON.parse(raw), note: "Parsed JSON response." }; }
  catch { return { payload: null, note: "Response body is not valid JSON." }; }
}

function rpcError(payload: unknown): string | null {
  const error = (payload as { error?: { code?: number; message?: string } } | null)?.error;
  if (!error) return null;
  return `JSON-RPC error ${error.code ?? "?"}: ${error.message ?? "no message"}`;
}

export async function runMcpDiagnostics({ origin, accessToken }: RunOptions): Promise<McpDiagnosticReport> {
  const endpoint = `${origin}/api/mcp`;
  const steps: McpDiagnosticStep[] = [];
  const mcpHeaders = {
    "content-type": "application/json",
    accept: MCP_ACCEPT,
    authorization: `Bearer ${accessToken}`,
    "mcp-protocol-version": "2025-06-18",
  };

  steps.push(await timed("https", "HTTPS reachability", async () => {
    const url = `${origin}/api/health`;
    const logs: string[] = [];
    if (!origin.startsWith("https://")) logs.push("Origin is not HTTPS. ChatGPT refuses non-HTTPS connectors outside localhost.");
    const response = await fetchWithTimeout(url, { method: "GET", headers: { accept: "application/json" } });
    const body = await readBody(response);
    logs.push(...headerLogs(response, ["server", "content-type", "location"]));
    const ok = response.ok && origin.startsWith("https://");
    return {
      status: ok ? "pass" : "fail",
      detail: ok ? `${origin} answered ${response.status} over HTTPS.` : `${origin} answered ${response.status}.`,
      request: { method: "GET", url },
      statusCode: response.status,
      body: ok ? undefined : body,
      logs,
    };
  }));

  steps.push(await timed("endpoint", "/mcp endpoint challenge", async () => {
    // Unauthenticated: the endpoint must answer 401 with a WWW-Authenticate
    // pointing at resource metadata, which is how ChatGPT discovers where to
    // start OAuth. A 200 here means the gateway is unprotected; a 404 means
    // the proxy never routed the path.
    const logs: string[] = [];
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: MCP_ACCEPT },
      body: rpc("initialize", {}, 0),
    });
    const challenge = response.headers.get("www-authenticate");
    logs.push(...headerLogs(response, ["www-authenticate", "content-type"]));
    const alias = await fetchWithTimeout(`${origin}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: MCP_ACCEPT }, body: rpc("initialize", {}, 0) }).catch(() => null);
    logs.push(alias ? `/mcp alias answered ${alias.status} (connector URL must be ${endpoint} unless this is 401).` : "/mcp alias unreachable; use the full /api/mcp URL.");
    const ok = response.status === 401 && Boolean(challenge?.includes("resource_metadata"));
    return {
      status: ok ? "pass" : "fail",
      detail: ok
        ? "Answered 401 with a resource_metadata challenge, as an MCP client expects."
        : response.status === 401
          ? "Answered 401 but the WWW-Authenticate header has no resource_metadata parameter."
          : `Expected 401, got ${response.status}.`,
      request: { method: "POST", url: endpoint },
      statusCode: response.status,
      body: ok ? undefined : await readBody(response),
      logs,
    };
  }));

  steps.push(await timed("oauth_discovery", "OAuth discovery", async () => {
    const logs: string[] = [];
    const resourceUrl = `${origin}/.well-known/oauth-protected-resource/mcp`;
    const resourceResponse = await fetchWithTimeout(resourceUrl, { method: "GET", headers: { accept: "application/json" } });
    const resourceRaw = await resourceResponse.text().catch(() => "");
    const resource = (() => { try { return JSON.parse(resourceRaw) as { resource?: string; authorization_servers?: string[] }; } catch { return null; } })();
    const serverUrl = `${origin}/.well-known/oauth-authorization-server`;
    const serverResponse = await fetchWithTimeout(serverUrl, { method: "GET", headers: { accept: "application/json" } });
    const serverRaw = await serverResponse.text().catch(() => "");
    const metadata = (() => { try { return JSON.parse(serverRaw) as Record<string, unknown>; } catch { return null; } })();

    const problems: string[] = [];
    if (!resourceResponse.ok) problems.push(`Protected-resource metadata returned ${resourceResponse.status}.`);
    if (!serverResponse.ok) problems.push(`Authorization-server metadata returned ${serverResponse.status}.`);
    if (resource && resource.resource !== endpoint) problems.push(`Advertised resource is "${resource.resource}" but the endpoint is "${endpoint}". A mismatch makes every token resource-invalid.`);
    for (const field of ["authorization_endpoint", "token_endpoint", "registration_endpoint"]) {
      if (metadata && !metadata[field]) problems.push(`Authorization-server metadata is missing ${field}.`);
    }
    const challenge = (metadata?.code_challenge_methods_supported as string[] | undefined) ?? [];
    if (metadata && !challenge.includes("S256")) problems.push("Authorization server does not advertise PKCE S256, which ChatGPT requires.");
    logs.push(`resource: ${sanitize(String(resource?.resource ?? "unset"))}`);
    logs.push(`authorization_servers: ${sanitize(JSON.stringify(resource?.authorization_servers ?? []))}`);

    return {
      status: problems.length ? "fail" : "pass",
      detail: problems.length ? problems.join(" ") : "Both discovery documents are present, consistent, and PKCE-capable.",
      request: { method: "GET", url: resourceUrl },
      statusCode: resourceResponse.status,
      body: problems.length ? truncate(sanitize(`${resourceRaw}\n\n${serverRaw}`)) : undefined,
      logs,
    };
  }));

  const chainBroken = () => steps.some((step) => step.status === "fail" && (step.id === "https" || step.id === "endpoint"));

  steps.push(await timed("initialize", "MCP Initialize", async () => {
    if (chainBroken()) return { status: "skipped", detail: "Skipped: the endpoint did not answer correctly." };
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: mcpHeaders,
      body: rpc("initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "sentinel-diagnostics", version: "1.0.0" },
      }, 1),
    });
    const raw = await response.text().catch(() => "");
    const { payload, note } = parseMcpBody(response.headers.get("content-type"), raw);
    const error = rpcError(payload);
    const info = (payload as { result?: { serverInfo?: { name?: string; version?: string }; protocolVersion?: string } } | null)?.result;
    const ok = response.ok && !error && Boolean(info?.serverInfo);
    return {
      status: ok ? "pass" : "fail",
      detail: ok
        ? `Handshake accepted by ${info?.serverInfo?.name ?? "server"} ${info?.serverInfo?.version ?? ""} (protocol ${info?.protocolVersion ?? "unknown"}).`.trim()
        : error ?? `Initialize returned ${response.status}.`,
      request: { method: "POST", url: endpoint },
      statusCode: response.status,
      body: ok ? undefined : truncate(sanitize(raw)),
      logs: [note, ...headerLogs(response, ["content-type", "mcp-session-id"])],
    };
  }));

  const handshakeOk = steps.find((step) => step.id === "initialize")?.status === "pass";

  steps.push(await timed("tools_list", "tools/list", async () => {
    if (!handshakeOk) return { status: "skipped", detail: "Skipped: the MCP handshake did not complete." };
    const response = await fetchWithTimeout(endpoint, { method: "POST", headers: mcpHeaders, body: rpc("tools/list", {}, 2) });
    const raw = await response.text().catch(() => "");
    const { payload, note } = parseMcpBody(response.headers.get("content-type"), raw);
    const error = rpcError(payload);
    const tools = (payload as { result?: { tools?: { name?: string }[] } } | null)?.result?.tools ?? [];
    const ok = response.ok && !error && tools.length > 0;
    return {
      status: ok ? "pass" : "fail",
      detail: ok ? `${tools.length} tools advertised: ${tools.map((tool) => tool.name).filter(Boolean).join(", ")}.` : error ?? `tools/list returned ${response.status} with no tools.`,
      request: { method: "POST", url: endpoint },
      statusCode: response.status,
      body: ok ? undefined : truncate(sanitize(raw)),
      logs: [note],
    };
  }));

  steps.push(await timed("tool_call", "Tool invocation", async () => {
    if (steps.find((step) => step.id === "tools_list")?.status !== "pass") {
      return { status: "skipped", detail: "Skipped: no tools were advertised." };
    }
    // sentinel.capabilities is the one read-only tool with no arguments and no
    // side effects, so a diagnostic run never mutates anything.
    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: mcpHeaders,
      body: rpc("tools/call", { name: "sentinel.capabilities", arguments: {} }, 3),
    });
    const raw = await response.text().catch(() => "");
    const { payload, note } = parseMcpBody(response.headers.get("content-type"), raw);
    const error = rpcError(payload);
    const result = (payload as { result?: { isError?: boolean; structuredContent?: { agents?: unknown[] } } } | null)?.result;
    const ok = response.ok && !error && result !== undefined && result.isError !== true;
    const agents = Array.isArray(result?.structuredContent?.agents) ? result.structuredContent.agents.length : null;
    return {
      status: ok ? "pass" : "fail",
      detail: ok
        ? `sentinel.capabilities executed${agents === null ? "" : ` and reported ${agents} agents`}.`
        : error ?? `Tool call returned ${response.status}.`,
      request: { method: "POST", url: endpoint },
      statusCode: response.status,
      body: ok ? undefined : truncate(sanitize(raw)),
      logs: [note],
    };
  }));

  const failures = steps.filter((step) => step.status === "fail");
  return {
    ok: failures.length === 0,
    origin,
    endpoint,
    ranAt: new Date().toISOString(),
    steps,
    fixPrompt: failures.length ? buildFixPrompt({ endpoint, steps, failures }) : undefined,
  };
}

function buildFixPrompt(input: { endpoint: string; steps: McpDiagnosticStep[]; failures: McpDiagnosticStep[] }): string {
  const lines = [
    "Sentinel's MCP gateway is failing the ChatGPT connector compatibility test. Diagnose and fix it.",
    "",
    `Connector endpoint: ${input.endpoint}`,
    "Stack: Next.js App Router. Route: src/app/api/mcp/route.ts. OAuth: src/lib/integrations/oauth.ts.",
    "Discovery: src/app/.well-known/oauth-protected-resource/mcp/route.ts and src/app/.well-known/oauth-authorization-server/route.ts.",
    "Public origin resolution: src/lib/integrations/public-origin.ts (AUTH_URL). Proxy matcher: src/proxy.ts.",
    "",
    "Chain result:",
    ...input.steps.map((step) => `  ${step.status === "pass" ? "PASS" : step.status === "fail" ? "FAIL" : "SKIP"}  ${step.label} — ${step.detail}`),
    "",
    "Failing steps in detail:",
  ];
  for (const step of input.failures) {
    lines.push("", `### ${step.label}`);
    if (step.request) lines.push(`Request: ${step.request.method} ${step.request.url}`);
    if (step.statusCode !== undefined) lines.push(`Status code: ${step.statusCode}`);
    lines.push(`Detail: ${step.detail}`);
    if (step.logs?.length) lines.push("Logs:", ...step.logs.map((log) => `  ${log}`));
    if (step.body) lines.push("Response body (secrets redacted):", "```", step.body, "```");
  }
  lines.push(
    "",
    "Find the root cause before changing anything, fix it at the source rather than special-casing the probe,",
    "and tell me what to re-run to confirm. Do not weaken OAuth verification or scope enforcement to make the test pass.",
  );
  return lines.join("\n");
}
