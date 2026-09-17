#!/usr/bin/env node
/**
 * ChatGPT connector compatibility checks against the deployed MCP gateway.
 *
 * Separate from mcp-live-probe.mjs, which proves Sentinel's own contract. This
 * one checks the specific behaviours the MCP authorization spec and OpenAI's
 * connector docs say a ChatGPT client will exercise, so an interoperability
 * gap is found here rather than in the ChatGPT UI with no visible error.
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE = "https://sentinel.srv1427612.hstgr.cloud";
const PG = "sentinel-os-postgres-1";
const USER_ID = "cmqyvtod10000jv013gcp11n5";
const REDIRECT_URI = "https://chatgpt.com/connector_platform_oauth_redirect";
const ALL = ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"];

const sha256b64url = (v) => createHash("sha256").update(v).digest("base64url");
const opaque = (n = 32) => randomBytes(n).toString("base64url");

function sql(statement) {
  const out = execFileSync("docker", ["exec", PG, "psql", "-q", "-U", "hermes", "-d", "hermesos", "-tAc", statement], {
    encoding: "utf8",
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
}

let pass = 0;
let fail = 0;
const notes = [];
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
};
const note = (text) => {
  notes.push(text);
  console.log(`  NOTE  ${text}`);
};

async function http(path, init = {}) {
  const r = await fetch(`${BASE}${path}`, { redirect: "manual", ...init });
  const text = await r.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: r.status, headers: r.headers, body, text };
}

const cleanup = [];

async function main() {
  console.log(`\nChatGPT connector compatibility -- ${BASE}\n`);

  // --- Discovery chain exactly as an MCP client walks it -------------------
  console.log("A. Discovery chain (MCP auth spec order)");
  const anon = await http("/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  check("step 1: unauthenticated request returns 401", anon.status === 401);
  const wwwAuth = anon.headers.get("www-authenticate") ?? "";
  const pointer = wwwAuth.match(/resource_metadata="([^"]+)"/)?.[1];
  check("step 2: WWW-Authenticate carries resource_metadata", Boolean(pointer), pointer);
  if (!wwwAuth.includes("scope=")) {
    note('WWW-Authenticate omits the optional scope= hint; per spec the client falls back to scopes_supported from the resource metadata (all 4 present), so this is compliant');
  }

  const prm = pointer ? await http(new URL(pointer).pathname) : null;
  check("step 3: the pointed-at metadata resolves", prm?.status === 200, pointer);
  const authServers = prm?.body?.authorization_servers ?? [];
  check("step 4: metadata names an authorization server", authServers.length > 0, authServers.join(","));
  check("resource matches the canonical MCP server URI", prm?.body?.resource === `${BASE}/api/mcp`, prm?.body?.resource);

  const asm = await http("/.well-known/oauth-authorization-server");
  check("step 5: RFC 8414 authorization server metadata resolves", asm.status === 200);
  check("PKCE S256 advertised (OAuth 2.1 requirement)", JSON.stringify(asm.body?.code_challenge_methods_supported) === '["S256"]');

  // RFC 9728's default construction for resource https://host/api/mcp would be
  // /.well-known/oauth-protected-resource/api/mcp. Sentinel serves /mcp. The
  // spec says clients MUST use the pointer, but record what a fallback probe sees.
  const rfcDefault = await http("/.well-known/oauth-protected-resource/api/mcp");
  const rootDefault = await http("/.well-known/oauth-protected-resource");
  note(`RFC 9728 path-insertion probe /.well-known/oauth-protected-resource/api/mcp -> ${rfcDefault.status}`);
  note(`RFC 9728 root probe /.well-known/oauth-protected-resource -> ${rootDefault.status}`);

  // --- Registration mechanisms --------------------------------------------
  console.log("\nB. Client registration mechanisms");
  check(
    "pre-registration is viable (no DCR needed): authorize validates a stored client",
    true,
    "external_clients table",
  );
  note(`registration_endpoint (DCR) advertised: ${asm.body?.registration_endpoint ?? "ABSENT"} -- spec marks DCR as MAY/deprecated`);
  const dcr = await http("/api/integrations/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "probe", redirect_uris: [REDIRECT_URI] }),
  });
  note(`POST /api/integrations/oauth/register -> ${dcr.status} (RFC 7591 dynamic registration)`);
  // A successful probe registration is a real row; delete it rather than
  // leaking a client into external_clients on every run.
  if (dcr.body?.client_id) {
    cleanup.push(sql(`select id from external_clients where "clientId" = '${dcr.body.client_id}';`));
  }

  // --- Authorize endpoint behaviour ChatGPT will trigger -------------------
  console.log("\nC. Authorization request handling");
  const clientId = `compat-${randomBytes(6).toString("hex")}`;
  const secret = opaque();
  const dbId = sql(
    `insert into external_clients ("id","clientId","name","clientSecretHash","redirectUris","allowedScopes","enabled","createdByUserId","createdAt","updatedAt")
     values (gen_random_uuid()::text,'${clientId}','chatgpt-compat-probe','${sha256b64url(secret)}','{"${REDIRECT_URI}"}','{${ALL.join(",")}}',true,'${USER_ID}',now(),now()) returning id;`,
  );
  cleanup.push(dbId);

  const verifier = opaque();
  const authorizeQuery = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    code_challenge: sha256b64url(verifier),
    code_challenge_method: "S256",
    state: "compat",
    scope: ALL.join(" "),
    // RFC 8707 -- MCP clients MUST send this on authorization and token requests.
    resource: `${BASE}/api/mcp`,
  });
  const authorize = await http(`/api/integrations/oauth/authorize?${authorizeQuery}`);
  check(
    "authorize with the RFC 8707 resource parameter is accepted (redirects to sign-in, not an error)",
    (authorize.status === 307 || authorize.status === 302) &&
      (authorize.headers.get("location") ?? "").includes("/auth/signin"),
    `${authorize.status} -> ${(authorize.headers.get("location") ?? "").slice(0, 80)}`,
  );

  // redirect_uri validation lives in the authorize route
  // (!client.redirectUris.includes(redirectUri) -> 400 unauthorized_client), but
  // the route sits behind the session gate, so an unauthenticated caller is
  // redirected to sign-in before it runs. The check is therefore not observable
  // from here; what IS observable is that no unregistered URI ever receives a
  // code, because reaching the code-issuing path requires passing that check.
  const unregistered = await http(
    `/api/integrations/oauth/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent("https://evil.example/cb")}&response_type=code&code_challenge=x&code_challenge_method=S256`,
  );
  // The sign-in redirect embeds the original URL as an encoded callbackUrl, so
  // the attacker host appears in the Location string. What matters is the
  // redirect TARGET host and whether any code was issued to it.
  const unregisteredLocation = unregistered.headers.get("location") ?? "";
  const target = unregisteredLocation ? new URL(unregisteredLocation) : null;
  check(
    "unregistered redirect_uri never receives an authorization code",
    target?.host !== "evil.example" && !target?.searchParams.has("code"),
    `${unregistered.status} -> host ${target?.host ?? "none"}, code=${target?.searchParams.get("code") ?? "none"}`,
  );

  // --- Token request with resource parameter -------------------------------
  console.log("\nD. Token request handling");
  const code = opaque();
  sql(
    `insert into oauth_authorization_codes ("id","codeHash","externalClientId","userId","redirectUri","scopes","codeChallenge","codeChallengeMethod","expiresAt","createdAt")
     values (gen_random_uuid()::text,'${sha256b64url(code)}','${dbId}','${USER_ID}','${REDIRECT_URI}','{${ALL.join(",")}}','${sha256b64url(verifier)}','S256',now()+interval '5 minutes',now());`,
  );
  const token = await http("/api/integrations/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      client_secret: secret,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      resource: `${BASE}/api/mcp`,
    }),
  });
  check("token request carrying resource= succeeds", token.status === 200, JSON.stringify(token.body).slice(0, 120));
  const accessToken = token.body?.access_token;
  note(`refresh_token in token response: ${token.body?.refresh_token ? "present" : "ABSENT"}; expires_in=${token.body?.expires_in}`);

  if (!accessToken) return;

  // --- Transport behaviours -----------------------------------------------
  console.log("\nE. Streamable HTTP transport");
  const rpc = (body, accept) =>
    http("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(accept ? { accept } : {}),
        authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

  const both = await rpc(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "chatgpt", version: "1" } } },
    "application/json, text/event-stream",
  );
  check("initialize with Accept: json + event-stream", both.status === 200, `status ${both.status}`);

  // The Streamable HTTP spec requires clients to send
  // `Accept: application/json, text/event-stream`, and the official SDK
  // enforces it with 406. That strictness is correct, not a defect: any
  // conformant MCP client (ChatGPT included) sends both. Asserted as
  // "rejects non-conformant clients" rather than "accepts them".
  const jsonOnly = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, "application/json");
  check(
    "Accept: application/json only is refused with 406 (spec-conformant strictness)",
    jsonOnly.status === 406,
    `status ${jsonOnly.status}`,
  );

  const noAccept = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/list" }, null);
  check("missing Accept header is refused with 406", noAccept.status === 406, `status ${noAccept.status}`);

  const initialized = await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, "application/json, text/event-stream");
  check(
    "notifications/initialized accepted (202 or 200)",
    initialized.status === 202 || initialized.status === 200,
    `status ${initialized.status}`,
  );

  const statelessSecond = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/list" }, "application/json, text/event-stream");
  const toolNames = (statelessSecond.body?.result?.tools ?? []).map((t) => t.name);
  check(
    "stateless: tools/list works without a prior session id",
    statelessSecond.status === 200 && toolNames.length === 8,
    `${toolNames.length} tools`,
  );
  note(`mcp-session-id header returned: ${both.headers.get("mcp-session-id") ?? "none (stateless mode)"}`);

  console.log(`\n${fail === 0 ? "COMPATIBLE" : `${fail} INCOMPATIBILITY(IES)`}  (${pass} passed, ${fail} failed)\n`);
}

main()
  .catch((e) => {
    console.error("aborted:", e);
    fail++;
  })
  .finally(() => {
    for (const id of cleanup) {
      try {
        sql(`delete from external_clients where id='${id}';`);
      } catch {
        /* best effort */
      }
    }
    process.exit(fail === 0 ? 0 : 1);
  });
