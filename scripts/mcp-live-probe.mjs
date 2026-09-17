#!/usr/bin/env node
/**
 * Live production probe for the Sentinel external MCP gateway.
 *
 * Exercises the deployed public origin end to end: discovery, the OAuth
 * authorization-code + PKCE exchange, an authenticated MCP session, scope
 * enforcement, a real orchestration round trip, and the negative cases
 * (invalid token, revoked token, replayed code).
 *
 * The one step that cannot be automated is the human consent click at
 * /api/integrations/oauth/authorize, which requires an interactive session.
 * The probe instead mints the authorization code exactly as that route does
 * after requireUser() -- same table, same SHA-256/base64url code hash, same
 * five-minute TTL -- and then drives the real HTTP token endpoint with it, so
 * every server-side check (client auth, PKCE, single-use, expiry) is genuinely
 * exercised against production.
 *
 * Usage: node scripts/mcp-live-probe.mjs [--base https://host] [--user <id>]
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};

const BASE = (flag("base", "https://sentinel.srv1427612.hstgr.cloud")).replace(/\/+$/, "");
const USER_ID = flag("user", "cmqyvtod10000jv013gcp11n5");
const PG = "sentinel-os-postgres-1";
const REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sha256b64url = (value) => createHash("sha256").update(value).digest("base64url");
const opaque = (bytes = 32) => randomBytes(bytes).toString("base64url");

function sql(statement) {
  const out = execFileSync(
    "docker",
    // -q suppresses the command tag ("INSERT 0 1"), which otherwise lands in
    // the same stream as a RETURNING value and corrupts every id read back.
    ["exec", PG, "psql", "-q", "-U", "hermes", "-d", "hermesos", "-tAc", statement],
    { encoding: "utf8" },
  );
  return out.split("\n").map((line) => line.trim()).filter(Boolean)[0] ?? "";
}

let pass = 0;
let fail = 0;
const failures = [];
function check(label, condition, detail = "") {
  if (condition) {
    pass += 1;
    console.log(`  PASS  ${label}${detail ? ` -- ${detail}` : ""}`);
  } else {
    fail += 1;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function http(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, headers: response.headers, body, text };
}

/** One JSON-RPC call over the deployed MCP endpoint. */
async function rpc(token, method, params) {
  const response = await http("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, ...(params ? { params } : {}) }),
  });
  // The MCP SDK transport may answer as SSE; unwrap the data frame if so.
  if (typeof response.body === "string" && response.body.includes("data:")) {
    const line = response.body.split("\n").find((l) => l.startsWith("data:"));
    if (line) {
      try {
        response.body = JSON.parse(line.slice(5).trim());
      } catch {
        /* leave as text */
      }
    }
  }
  return response;
}

/** Registers a throwaway ExternalClient and returns its ids/secret. */
function createClient(name, scopes) {
  const clientId = `probe-${randomBytes(6).toString("hex")}`;
  const secret = opaque();
  const scopeLiteral = `{${scopes.join(",")}}`;
  const id = sql(
    `insert into external_clients ("id","clientId","name","clientSecretHash","redirectUris","allowedScopes","enabled","createdByUserId","createdAt","updatedAt")
     values (gen_random_uuid()::text, '${clientId}', '${name}', '${sha256b64url(secret)}', '{"${REDIRECT_URI}"}', '${scopeLiteral}', true, '${USER_ID}', now(), now())
     returning id;`,
  );
  return { id, clientId, secret, scopes };
}

/** Mints an authorization code exactly as the consent route does post-requireUser(). */
function issueCode(client, scopes, codeChallenge) {
  const code = opaque();
  sql(
    `insert into oauth_authorization_codes ("id","codeHash","externalClientId","userId","redirectUri","scopes","codeChallenge","codeChallengeMethod","expiresAt","createdAt")
     values (gen_random_uuid()::text, '${sha256b64url(code)}', '${client.id}', '${USER_ID}', '${REDIRECT_URI}', '{${scopes.join(",")}}', '${codeChallenge}', 'S256', now() + interval '5 minutes', now());`,
  );
  return code;
}

async function exchange(client, code, verifier) {
  return http("/api/integrations/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: client.clientId,
      client_secret: client.secret,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  });
}

/** Full consent-equivalent handshake: client -> code -> token. */
async function connect(name, scopes) {
  const client = createClient(name, scopes);
  const verifier = opaque();
  const code = issueCode(client, scopes, sha256b64url(verifier));
  const token = await exchange(client, code, verifier);
  return { client, verifier, code, token };
}

const cleanup = [];

async function main() {
  console.log(`\nSentinel MCP live probe -- ${BASE}\n`);

  // ---- 1. Discovery -------------------------------------------------------
  console.log("1. Discovery");
  const prm = await http("/.well-known/oauth-protected-resource/mcp");
  check("protected-resource returns 200 JSON, not sign-in HTML", prm.status === 200 && typeof prm.body === "object");
  check("resource is the public origin", prm.body?.resource === `${BASE}/api/mcp`, prm.body?.resource);
  check("no /auth/signin anywhere in the response", !prm.text.includes("/auth/signin"));

  const asm = await http("/.well-known/oauth-authorization-server");
  check("authorization-server returns 200 JSON", asm.status === 200 && typeof asm.body === "object");
  check("issuer is the public origin", asm.body?.issuer === BASE, asm.body?.issuer);
  check(
    "authorization_endpoint is publicly reachable",
    asm.body?.authorization_endpoint === `${BASE}/api/integrations/oauth/authorize`,
  );
  check("token_endpoint is publicly reachable", asm.body?.token_endpoint === `${BASE}/api/integrations/oauth/token`);
  check("advertises S256 PKCE", JSON.stringify(asm.body?.code_challenge_methods_supported) === '["S256"]');

  // ---- 2. Unauthenticated MCP --------------------------------------------
  console.log("\n2. Unauthenticated access");
  const anon = await http("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check("POST /api/mcp is 401, not 307", anon.status === 401, `got ${anon.status}`);
  const challenge = anon.headers.get("www-authenticate") ?? "";
  check("401 carries WWW-Authenticate: Bearer", challenge.startsWith("Bearer "));
  check("challenge points at the public resource metadata", challenge.includes(`${BASE}/.well-known/`), challenge);

  // ---- 3. Session boundary intact ----------------------------------------
  console.log("\n3. Session boundary (must NOT be weakened)");
  const authorize = await http("/api/integrations/oauth/authorize?client_id=x&redirect_uri=https://example.com/cb");
  check(
    "consent screen still requires interactive sign-in",
    authorize.status === 307 || authorize.status === 302,
    `status ${authorize.status}`,
  );
  const page = await http("/dashboard");
  check("web pages still redirect anonymous visitors to sign-in", page.status === 307 || page.status === 302);
  const apiPage = await http("/api/agents");
  check("other API routes still reject anonymous callers", apiPage.status === 401 || apiPage.status === 307);

  // ---- 4. OAuth token exchange -------------------------------------------
  console.log("\n4. OAuth authorization-code + PKCE exchange");
  const allScopes = ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"];
  const full = await connect("mcp-live-probe-full", allScopes);
  cleanup.push(full.client.id);
  check("token exchange succeeds", full.token.status === 200, JSON.stringify(full.token.body).slice(0, 160));
  const accessToken = full.token.body?.access_token;
  check("access_token issued", Boolean(accessToken));
  check("token_type is Bearer", full.token.body?.token_type === "Bearer");
  check("granted scopes echoed", (full.token.body?.scope ?? "").split(" ").sort().join() === allScopes.slice().sort().join());

  const replay = await exchange(full.client, full.code, full.verifier);
  check("replaying the authorization code is rejected", replay.status === 400 && replay.body?.error === "invalid_grant");

  const badPkce = await connect("mcp-live-probe-pkce", allScopes);
  cleanup.push(badPkce.client.id);
  const wrongVerifier = await exchange(badPkce.client, badPkce.code, opaque());
  check("wrong PKCE verifier is rejected", wrongVerifier.status === 400 && wrongVerifier.body?.error === "invalid_grant");

  const wrongSecret = await connect("mcp-live-probe-secret", allScopes);
  cleanup.push(wrongSecret.client.id);
  const badSecret = await exchange({ ...wrongSecret.client, secret: opaque() }, wrongSecret.code, wrongSecret.verifier);
  check("wrong client secret is rejected", badSecret.status === 400 && badSecret.body?.error === "invalid_client");

  if (!accessToken) {
    console.log("\nCannot continue without an access token.\n");
    return;
  }

  // ---- 5. MCP session -----------------------------------------------------
  console.log("\n5. MCP session");
  const init = await rpc(accessToken, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "sentinel-live-probe", version: "1.0.0" },
  });
  check("initialize succeeds", init.status === 200 && Boolean(init.body?.result), JSON.stringify(init.body).slice(0, 200));
  check("server identifies itself", init.body?.result?.serverInfo?.name === "sentinel", init.body?.result?.serverInfo?.name);
  check("protocol version negotiated", Boolean(init.body?.result?.protocolVersion), init.body?.result?.protocolVersion);

  const list = await rpc(accessToken, "tools/list");
  const tools = (list.body?.result?.tools ?? []).map((t) => t.name).sort();
  check("tools/list succeeds", list.status === 200 && tools.length > 0, tools.join(", "));
  const expected = [
    "sentinel.agent_status",
    "sentinel.cancel_task",
    "sentinel.get_result",
    "sentinel.get_task",
    "sentinel.list_agents",
    "sentinel.memory_search",
    "sentinel.project_context",
    "sentinel.route_task",
  ];
  check("all 8 orchestration tools exposed at full scope", expected.every((t) => tools.includes(t)), `${tools.length} tools`);

  // ---- 6. Authorized read -------------------------------------------------
  console.log("\n6. Authorized read operations");
  const agents = await rpc(accessToken, "tools/call", { name: "sentinel.list_agents", arguments: {} });
  check("tools/call sentinel.list_agents succeeds", agents.status === 200 && agents.body?.result?.isError !== true,
    JSON.stringify(agents.body?.result?.content?.[0]?.text ?? agents.body).slice(0, 160));

  const memory = await rpc(accessToken, "tools/call", { name: "sentinel.memory_search", arguments: { query: "sentinel" } });
  check("tools/call sentinel.memory_search succeeds", memory.status === 200 && memory.body?.result?.isError !== true,
    JSON.stringify(memory.body?.result?.content?.[0]?.text ?? memory.body).slice(0, 160));

  // ---- 7. Scope enforcement ----------------------------------------------
  console.log("\n7. Scope enforcement");
  const readOnly = await connect("mcp-live-probe-readonly", ["sentinel.read"]);
  cleanup.push(readOnly.client.id);
  const readOnlyToken = readOnly.token.body?.access_token;
  check("read-only token issued", Boolean(readOnlyToken));

  if (readOnlyToken) {
    // The server registers the full catalogue for every principal and enforces
    // scope inside each handler (requireScope), so tools/list is deliberately
    // NOT filtered. The security contract to verify is therefore that an
    // under-scoped token cannot *execute* a privileged tool -- listing it is
    // not a capability. Recorded below rather than asserted as a failure.
    const scopedList = await rpc(readOnlyToken, "tools/list");
    const scopedTools = (scopedList.body?.result?.tools ?? []).map((t) => t.name);
    console.log(`  NOTE  tools/list is unfiltered by design: ${scopedTools.length} tools advertised at read-only scope`);

    const privileged = [
      ["sentinel.route_task", { task: "probe must never execute this" }, "sentinel.tasks.write"],
      ["sentinel.memory_search", { query: "probe" }, "sentinel.memory.read"],
      ["sentinel.get_task", { taskId: "probe" }, "sentinel.tasks.read"],
      ["sentinel.cancel_task", { taskId: "probe" }, "sentinel.tasks.write"],
    ];
    for (const [name, argumentsValue, needed] of privileged) {
      const denied = await rpc(readOnlyToken, "tools/call", { name, arguments: argumentsValue });
      const text = JSON.stringify(denied.body).toLowerCase();
      check(
        `${name} is denied without ${needed}`,
        text.includes("missing required scope") && text.includes(needed),
        text.slice(0, 120),
      );
    }

    const allowed = await rpc(readOnlyToken, "tools/call", { name: "sentinel.list_agents", arguments: {} });
    check("read-only token can still call its in-scope tool", allowed.status === 200 && allowed.body?.result?.isError !== true);
  }

  // ---- 8. Orchestration round trip ---------------------------------------
  console.log("\n8. Orchestration round trip");
  const routed = await rpc(accessToken, "tools/call", {
    name: "sentinel.route_task",
    arguments: { task: "Sentinel MCP live probe: report readiness. No side effects required." },
  });
  const routedText = routed.body?.result?.content?.[0]?.text ?? "";
  check("sentinel.route_task returns a response", routed.status === 200, JSON.stringify(routed.body).slice(0, 200));
  let runId = null;
  try {
    const structured = routed.body?.result?.structuredContent ?? JSON.parse(routedText);
    // route_task answers { task: { id, status, resolvedAgentId, ... } }.
    runId = structured?.task?.id ?? structured?.runId ?? structured?.run?.id ?? structured?.id ?? null;
  } catch {
    const match = String(routedText).match(/\b[a-z0-9]{24,}\b/i);
    runId = match ? match[0] : null;
  }
  check("route_task yielded a task id", Boolean(runId), String(runId));

  if (runId) {
    const got = await rpc(accessToken, "tools/call", { name: "sentinel.get_task", arguments: { taskId: runId } });
    check("sentinel.get_task resolves the run", got.status === 200 && got.body?.result?.isError !== true,
      JSON.stringify(got.body?.result?.content?.[0]?.text ?? "").slice(0, 160));
    const result = await rpc(accessToken, "tools/call", { name: "sentinel.get_result", arguments: { taskId: runId } });
    check("sentinel.get_result responds", result.status === 200,
      JSON.stringify(result.body?.result?.content?.[0]?.text ?? "").slice(0, 160));
    const cancelled = await rpc(accessToken, "tools/call", { name: "sentinel.cancel_task", arguments: { taskId: runId } });
    check("sentinel.cancel_task responds (probe run cleaned up)", cancelled.status === 200,
      JSON.stringify(cancelled.body?.result?.content?.[0]?.text ?? "").slice(0, 160));
  }

  // ---- 9. Negative token cases -------------------------------------------
  console.log("\n9. Invalid and revoked tokens");
  const garbage = await rpc("not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "tools/list");
  check("garbage bearer token is rejected with 401", garbage.status === 401, `got ${garbage.status}`);

  sql(`update oauth_access_tokens set "revokedAt" = now() where "externalClientId" = '${full.client.id}';`);
  const revoked = await rpc(accessToken, "tools/list");
  check("revoked token stops working immediately", revoked.status === 401, `got ${revoked.status}`);

  // ---- 10. Audit trail ----------------------------------------------------
  console.log("\n10. Auditing still records MCP use");
  const audited = sql(`select count(*) from audit_logs where action = 'mcp.invocation' and "createdAt" > now() - interval '10 minutes';`);
  check("mcp.invocation audit rows written during this probe", Number(audited) > 0, `${audited} rows`);

  console.log(`\n${fail === 0 ? "ALL LIVE CHECKS PASSED" : `${fail} CHECK(S) FAILED`}  (${pass} passed, ${fail} failed)`);
  if (fail) console.log(`Failed: ${failures.join("; ")}`);
}

main()
  .catch((error) => {
    console.error("\nProbe aborted:", error);
    fail += 1;
  })
  .finally(() => {
    for (const id of cleanup) {
      try {
        sql(`delete from external_clients where id = '${id}';`);
      } catch {
        /* best effort */
      }
    }
    console.log(`\nCleaned up ${cleanup.length} probe client(s).\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
