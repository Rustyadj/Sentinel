#!/usr/bin/env node
/**
 * Canonical external-client probe for Sentinel MCP.
 *
 * Full mode uses only public DCR, OAuth, and MCP interfaces and pauses for the
 * real human consent screen. It never seeds codes/users through the database,
 * mocks an execution, or logs credentials. Discovery-only mode performs no
 * writes and is safe for deployment drift checks.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);
const base = (flag("base", "http://127.0.0.1:3000") ?? "").replace(/\/+$/, "");
const callbackPort = Number(flag("callback-port", "43117"));
const callbackUri = `http://127.0.0.1:${callbackPort}/callback`;
const discoveryOnly = has("discovery-only");
const requireNegativeFixtures = has("require-negative-fixtures");
const preferredAgentId = flag("agent");
const memoryQuery = flag("memory-query", "Sentinel");
const taskPrompt = flag("task", "Return a concise Sentinel MCP readiness report. Do not modify files or external systems.");
const foreignTaskId = flag("foreign-task-id");
const foreignToken = process.env.MCP_PROBE_FOREIGN_TOKEN;
const expiredToken = process.env.MCP_PROBE_EXPIRED_TOKEN;
const revokedToken = process.env.MCP_PROBE_REVOKED_TOKEN;
const allScopes = ["sentinel.read", "sentinel.memory.read", "sentinel.tasks.read", "sentinel.tasks.write"];
const resource = `${base}/api/mcp`;
const localBase = ["localhost", "127.0.0.1", "::1"].includes(new URL(base).hostname);
const verifier = randomBytes(48).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
const state = randomBytes(24).toString("base64url");
let rpcId = 0;
let failures = 0;
let skips = 0;

function report(label, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}
function skip(label, reason) {
  skips += 1;
  console.log(`SKIP  ${label} — ${reason}`);
}
function note(label, detail) {
  console.log(`NOTE  ${label} — ${detail}`);
}

async function request(url, init = {}) {
  const response = await fetch(url.startsWith("http") ? url : `${base}${url}`, { redirect: "manual", ...init });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (typeof body === "string" && body.includes("data:")) {
    const data = body.split("\n").find((line) => line.startsWith("data:"));
    if (data) try { body = JSON.parse(data.slice(5).trim()); } catch { /* preserve raw body */ }
  }
  return { response, body, text };
}
async function form(url, fields) {
  return request(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields) });
}
async function rpc(token, method, params) {
  return request(resource, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, ...(params ? { params } : {}) }),
  });
}
const structured = (result) => result.body?.result?.structuredContent;
const toolFailed = (result) => result.response.status !== 200 || result.body?.result?.isError === true || Boolean(result.body?.error);
const callTool = (token, name, args = {}) => rpc(token, "tools/call", { name, arguments: args });

function waitForAuthorizationCallback() {
  return new Promise((resolve, reject) => {
    let server;
    const timeout = setTimeout(() => {
      server?.close();
      reject(new Error("Timed out waiting for OAuth callback (5 minutes)."));
    }, 5 * 60_000);
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", callbackUri);
      if (url.pathname !== "/callback") return void res.writeHead(404).end("Not found");
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("Sentinel authorization received. Return to the terminal.");
      clearTimeout(timeout);
      server.close();
      resolve(url);
    });
    server.on("error", reject);
    server.listen(callbackPort, "127.0.0.1");
  });
}

async function discovery() {
  console.log(`\nSentinel MCP probe: ${base}\n`);
  const unauthenticated = await request(resource);
  const challengeHeader = unauthenticated.response.headers.get("www-authenticate") ?? "";
  const metadataUrl = challengeHeader.match(/resource_metadata="([^"]+)"/)?.[1];
  report("GET /api/mcp returns 401", unauthenticated.response.status === 401, `HTTP ${unauthenticated.response.status}`);
  report("WWW-Authenticate points to public resource metadata", Boolean(metadataUrl?.startsWith(base)), metadataUrl ?? "missing");
  const protectedMetadata = metadataUrl ? await request(metadataUrl) : null;
  report("protected-resource metadata resolves", protectedMetadata?.response.status === 200);
  report("protected resource is the exact public MCP URL", protectedMetadata?.body?.resource === resource, protectedMetadata?.body?.resource);
  const authorizationServer = protectedMetadata?.body?.authorization_servers?.[0];
  report("authorization server uses the public origin", authorizationServer === base, authorizationServer);
  const authorizationMetadata = await request(`${base}/.well-known/oauth-authorization-server`);
  report("authorization-server metadata resolves", authorizationMetadata.response.status === 200);
  report("DCR is advertised", typeof authorizationMetadata.body?.registration_endpoint === "string");
  report("PKCE S256 is advertised", authorizationMetadata.body?.code_challenge_methods_supported?.includes("S256"));
  report("authorization code and refresh grants are advertised", ["authorization_code", "refresh_token"].every((grant) => authorizationMetadata.body?.grant_types_supported?.includes(grant)));
  report("least-privilege Sentinel scopes are advertised", allScopes.every((scope) => authorizationMetadata.body?.scopes_supported?.includes(scope)));
  if (localBase) note("public-origin URL inspection", "the probe target is intentionally loopback");
  else for (const value of [metadataUrl, protectedMetadata?.body?.resource, authorizationServer,
    authorizationMetadata.body?.authorization_endpoint, authorizationMetadata.body?.token_endpoint,
    authorizationMetadata.body?.registration_endpoint]) {
      report("discovery URL contains no internal host or port",
        typeof value === "string" && !/localhost|0\.0\.0\.0|host\.docker\.internal|:\d{4,5}(?:\/|$)/i.test(value), String(value));
    }
  return authorizationMetadata.body;
}

async function assertRejectedToken(token, label) {
  const result = await rpc(token, "tools/list");
  report(label, result.response.status === 401, `HTTP ${result.response.status}`);
}

async function main() {
  const metadata = await discovery();
  if (discoveryOnly) return;

  const registration = await request(metadata.registration_endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "Sentinel canonical MCP probe", redirect_uris: [callbackUri],
      grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none", scope: allScopes.join(" ") }),
  });
  report("dynamic client registration succeeds", registration.response.status === 201, `HTTP ${registration.response.status}`);
  const clientId = registration.body?.client_id;
  if (!clientId) throw new Error("DCR returned no client_id.");

  const authorize = new URL(metadata.authorization_endpoint);
  for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: callbackUri, response_type: "code",
    code_challenge: challenge, code_challenge_method: "S256", state, scope: allScopes.join(" "), resource })) {
    authorize.searchParams.set(key, value);
  }
  const callback = waitForAuthorizationCallback();
  console.log(`\nACTION REQUIRED: open this URL, sign in as the intended Sentinel owner, review the scopes, and approve:\n\n${authorize}\n`);
  const callbackUrl = await callback;
  report("OAuth state round-trips", callbackUrl.searchParams.get("state") === state);
  if (callbackUrl.searchParams.get("error")) throw new Error(`Authorization failed: ${callbackUrl.searchParams.get("error")}`);
  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("OAuth callback returned no code.");

  const common = { grant_type: "authorization_code", code, client_id: clientId, redirect_uri: callbackUri, resource };
  const wrongClient = await form(metadata.token_endpoint, { ...common, client_id: `wrong-${clientId}`, code_verifier: verifier });
  report("wrong client cannot exchange the code", wrongClient.response.status === 400 && wrongClient.body?.error === "invalid_client");
  const wrongPkce = await form(metadata.token_endpoint, { ...common, code_verifier: `${verifier}wrong` });
  report("wrong PKCE verifier is rejected", wrongPkce.response.status === 400 && wrongPkce.body?.error === "invalid_grant");
  const token = await form(metadata.token_endpoint, { ...common, code_verifier: verifier });
  report("authorization code exchanges for tokens", token.response.status === 200);
  const accessToken = token.body?.access_token;
  const refreshToken = token.body?.refresh_token;
  if (!accessToken || !refreshToken) throw new Error("Token response did not include access and refresh tokens.");
  const codeReplay = await form(metadata.token_endpoint, { ...common, code_verifier: verifier });
  report("authorization code is single-use", codeReplay.response.status === 400 && codeReplay.body?.error === "invalid_grant");

  const initialized = await rpc(accessToken, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sentinel-e2e-probe", version: "1.0.0" } });
  report("MCP initialize succeeds", initialized.response.status === 200 && Boolean(initialized.body?.result?.serverInfo));
  const listed = await rpc(accessToken, "tools/list");
  const names = listed.body?.result?.tools?.map((tool) => tool.name) ?? [];
  const requiredTools = ["sentinel.profile", "sentinel.capabilities", "sentinel.project_context", "sentinel.memory_search",
    "sentinel.route_task", "sentinel.get_task", "sentinel.get_result", "sentinel.cancel_task"];
  report("tools/list exposes the control-plane workflow", requiredTools.every((name) => names.includes(name)), `${names.length} tools`);

  const profile = await callTool(accessToken, "sentinel.profile");
  report("stable authenticated Sentinel identity resolves", !toolFailed(profile) && Boolean(structured(profile)?.id), structured(profile)?.id);
  const capabilities = await callTool(accessToken, "sentinel.capabilities");
  report("agent capabilities/status resolve from the registry", !toolFailed(capabilities) && (structured(capabilities)?.agents?.length ?? 0) > 0);
  const discoveredAgentId = preferredAgentId ?? structured(capabilities)?.agents?.find((agent) => agent.executable === true)?.id;
  report("a registry-discovered agent is ready for execution", typeof discoveredAgentId === "string", discoveredAgentId ?? "none");
  const context = await callTool(accessToken, "sentinel.project_context");
  report("permitted project/workspace context resolves", !toolFailed(context));
  const contextData = structured(context) ?? {};
  const selectedProjectId = contextData.scope?.projectId ?? contextData.choices?.projects?.[0]?.id ?? null;
  const selectedWorkspaceId = selectedProjectId ? null : contextData.scope?.workspaceId ?? contextData.choices?.workspaces?.[0]?.id ?? null;
  report("context returns a usable permitted id", Boolean(selectedProjectId || selectedWorkspaceId));
  if (!selectedProjectId && !selectedWorkspaceId) throw new Error("The authenticated identity has no usable permitted project/workspace.");
  const explicitContext = selectedProjectId ? { projectId: selectedProjectId } : { workspaceId: selectedWorkspaceId };
  if ((contextData.choices?.projects?.length ?? 0) > 1) report("ambiguous context returns choices instead of guessing", !contextData.scope?.projectId);
  else skip("ambiguous project context", "identity does not currently have multiple permitted projects");

  const forbiddenProject = await callTool(accessToken, "sentinel.project_context", { projectId: `unauthorized-${randomBytes(8).toString("hex")}` });
  report("unauthorized project id does not leak existence", !toolFailed(forbiddenProject) && !structured(forbiddenProject)?.scope?.projectId);
  const memory = await callTool(accessToken, "sentinel.memory_search", { query: memoryQuery, ...explicitContext });
  const memories = structured(memory)?.memories ?? [];
  report("governed memory search returns useful provenance-bearing rows", !toolFailed(memory) && memories.length > 0 && memories.every((item) => item.source && item.updatedAt), `${memories.length} result(s)`);
  const unavailable = await callTool(accessToken, "sentinel.route_task", { task: "This must not execute.", ...explicitContext, preferredAgentId: `unavailable-${randomBytes(6).toString("hex")}` });
  report("unavailable agent fails without fake work", toolFailed(unavailable));

  const routed = await callTool(accessToken, "sentinel.route_task", { task: taskPrompt, mode: "async", ...explicitContext,
    idempotencyKey: `probe-auto-${randomBytes(16).toString("hex")}` });
  const taskId = structured(routed)?.task?.id;
  report("route_task creates a real durable execution", !toolFailed(routed) && Boolean(taskId), taskId);
  if (!taskId) throw new Error("route_task returned no execution id.");

  let task;
  const deadline = Date.now() + 3 * 60_000;
  while (Date.now() < deadline) {
    task = await callTool(accessToken, "sentinel.get_task", { taskId });
    if (["succeeded", "failed", "cancelled"].includes(structured(task)?.task?.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  report("get_task reaches terminal durable state", !toolFailed(task) && ["succeeded", "failed", "cancelled"].includes(structured(task)?.task?.status), structured(task)?.task?.status);
  const result = await callTool(accessToken, "sentinel.get_result", { taskId });
  report("get_result returns a validated real result", !toolFailed(result) && structured(result)?.task?.status === "succeeded" && structured(result)?.task?.validation?.passed === true);

  const explicitlyRouted = discoveredAgentId ? await callTool(accessToken, "sentinel.route_task", { task: taskPrompt, mode: "async", ...explicitContext,
    preferredAgentId: discoveredAgentId, idempotencyKey: `probe-explicit-${randomBytes(16).toString("hex")}` }) : null;
  const explicitTaskId = structured(explicitlyRouted)?.task?.id;
  report("explicit requested agent is honored without splitting work", Boolean(explicitTaskId && !toolFailed(explicitlyRouted) && structured(explicitlyRouted)?.task?.resolvedAgentId === discoveredAgentId), explicitTaskId);
  let explicitTask;
  if (explicitTaskId) {
    const explicitDeadline = Date.now() + 3 * 60_000;
    while (Date.now() < explicitDeadline) {
      explicitTask = await callTool(accessToken, "sentinel.get_task", { taskId: explicitTaskId });
      if (["succeeded", "failed", "cancelled"].includes(structured(explicitTask)?.task?.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
  report("explicit selected agent reaches a durable terminal state", Boolean(explicitTask && !toolFailed(explicitTask) && structured(explicitTask)?.task?.status === "succeeded"), structured(explicitTask)?.task?.status);

  const cancellable = await callTool(accessToken, "sentinel.route_task", { task: "For this harmless cancellation check, wait 45 seconds before returning a one-line status. Do not modify files or external systems.", mode: "async", ...explicitContext,
    ...(discoveredAgentId ? { preferredAgentId: discoveredAgentId } : {}), idempotencyKey: `cancel-${randomBytes(16).toString("hex")}` });
  const cancellableId = structured(cancellable)?.task?.id;
  const cancelled = cancellableId ? await callTool(accessToken, "sentinel.cancel_task", { taskId: cancellableId }) : null;
  let cancelledState = structured(cancelled)?.status;
  if (cancellableId && cancelledState === "cancelling") {
    const cancellationDeadline = Date.now() + 30_000;
    while (Date.now() < cancellationDeadline) {
      const status = await callTool(accessToken, "sentinel.get_task", { taskId: cancellableId });
      cancelledState = structured(status)?.task?.status;
      if (cancelledState === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  report("cancel_task targets and cancels the owned execution", Boolean(cancelled && !toolFailed(cancelled) && cancelledState === "cancelled"), cancellableId);

  const unknownOwner = await callTool(accessToken, "sentinel.get_task", { taskId: foreignTaskId ?? `other-${randomBytes(12).toString("hex")}` });
  report("unknown/cross-owner execution is indistinguishable from not found", toolFailed(unknownOwner) && JSON.stringify(unknownOwner.body).includes("Task not found"));
  if (foreignToken) {
    const crossUser = await callTool(foreignToken, "sentinel.get_task", { taskId });
    report("second authenticated user cannot read this execution", toolFailed(crossUser));
  } else skip("authenticated cross-user access", "set MCP_PROBE_FOREIGN_TOKEN for another user");

  const refreshed = await form(metadata.token_endpoint, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource });
  const accessV2 = refreshed.body?.access_token;
  const refreshV2 = refreshed.body?.refresh_token;
  report("refresh token rotates", refreshed.response.status === 200 && accessV2 && refreshV2 && refreshV2 !== refreshToken);
  const continued = accessV2 ? await rpc(accessV2, "tools/list") : null;
  report("MCP continues without another consent", continued?.response.status === 200 && Boolean(continued.body?.result?.tools));
  const narrowed = await form(metadata.token_endpoint, { grant_type: "refresh_token", refresh_token: refreshV2, client_id: clientId, resource, scope: "sentinel.read" });
  const readOnlyToken = narrowed.body?.access_token;
  const insufficient = readOnlyToken ? await callTool(readOnlyToken, "sentinel.route_task", { task: "must not execute", ...explicitContext }) : null;
  report("insufficient scope blocks write tools", Boolean(insufficient && toolFailed(insufficient) && JSON.stringify(insufficient.body).includes("sentinel.tasks.write")));
  const replay = await form(metadata.token_endpoint, { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, resource });
  report("refresh replay is detected", replay.response.status === 400 && replay.body?.error === "invalid_grant");
  const invalidatedAfterReplay = accessV2 ? await rpc(accessV2, "tools/list") : null;
  report("refresh replay prevents continued access for that token family", invalidatedAfterReplay?.response.status === 401, `HTTP ${invalidatedAfterReplay?.response.status ?? "n/a"}`);

  await assertRejectedToken(`invalid-${randomBytes(32).toString("base64url")}`, "invalid access token is rejected");
  if (expiredToken) await assertRejectedToken(expiredToken, "expired access token is rejected");
  else skip("expired access token", "set MCP_PROBE_EXPIRED_TOKEN to an expired fixture");
  if (revokedToken) await assertRejectedToken(revokedToken, "revoked access token is rejected");
  else skip("revoked access token", "set MCP_PROBE_REVOKED_TOKEN to a revoked fixture");
}

main().catch((error) => {
  failures += 1;
  console.error(`FAIL  probe aborted — ${error instanceof Error ? error.message : String(error)}`);
}).finally(() => {
  console.log(`\n${failures === 0 ? "PROBE PASSED" : "PROBE FAILED"}: ${failures} failure(s), ${skips} skipped fixture-dependent check(s).\n`);
  process.exitCode = failures > 0 || (requireNegativeFixtures && skips > 0) ? 1 : 0;
});
