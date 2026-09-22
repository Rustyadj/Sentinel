#!/usr/bin/env node
/**
 * Live end-to-end probe for the external MCP gateway.
 *
 * The vitest suite (tests/mcp/gateway.test.ts) proves the protocol in-process.
 * This proves the deployed host: that the discovery documents are reachable at
 * the site root, that /api/mcp really challenges with WWW-Authenticate, and
 * that a token minted through the real consent screen calls real tools against
 * real data.
 *
 * It runs in two passes, because consent is a human at a browser:
 *
 *   1. node scripts/mcp-smoke.mjs --base https://sentinel.example
 *      Checks discovery + the 401 challenge, registers a client, and prints
 *      an authorize URL. State is saved to .mcp-smoke.json.
 *
 *   2. node scripts/mcp-smoke.mjs --code <code-from-the-redirect>
 *      Exchanges the code, then runs initialize -> tools/list -> tools/call
 *      and a scope-denial check.
 */
import { createHash, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const STATE_FILE = new URL("../.mcp-smoke.json", import.meta.url);

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : null;
};

const saved = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {};
const base = (flag("base") ?? saved.base ?? process.env.MCP_BASE_URL ?? "").replace(/\/+$/, "");
if (!base) {
  console.error("Pass --base https://your-sentinel-host (or set MCP_BASE_URL).");
  process.exit(2);
}

let failures = 0;
function check(label, condition, detail = "") {
  if (!condition) failures += 1;
  console.log(`  ${condition ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
}

async function json(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body };
}

async function passOne() {
  console.log(`\nMCP gateway probe against ${base}\n`);

  console.log("Discovery");
  const as = await json(`${base}/.well-known/oauth-authorization-server`);
  check("authorization server metadata is served", as.response.ok);
  check("advertises S256 PKCE only", JSON.stringify(as.body?.code_challenge_methods_supported) === '["S256"]');
  const prm = await json(`${base}/.well-known/oauth-protected-resource`);
  check("protected resource metadata is served", prm.response.ok);
  check("resource points at /api/mcp", prm.body?.resource === `${base}/api/mcp`);

  console.log("\nUnauthenticated access");
  const anonymous = await fetch(`${base}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check("POST /api/mcp without a token is 401", anonymous.status === 401, `got ${anonymous.status}`);
  check(
    "401 carries a WWW-Authenticate resource pointer",
    (anonymous.headers.get("www-authenticate") ?? "").includes("resource_metadata"),
  );

  console.log("\nRegistration");
  const redirectUri = "http://127.0.0.1:7777/callback";
  const registration = await json(`${base}/api/mcp/oauth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: "sentinel-smoke-probe", redirect_uris: [redirectUri] }),
  });
  check(
    "dynamic client registration succeeds",
    registration.response.status === 201,
    `got ${registration.response.status}`,
  );
  if (!registration.body?.client_id) {
    console.error("\nCannot continue without a client_id.");
    process.exit(1);
  }

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  writeFileSync(
    STATE_FILE,
    JSON.stringify({ base, clientId: registration.body.client_id, verifier, redirectUri }, null, 2),
  );

  const authorizeUrl = new URL(`${base}/mcp/authorize`);
  authorizeUrl.searchParams.set("client_id", registration.body.client_id);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", "smoke");
  authorizeUrl.searchParams.set("scope", registration.body.scope);
  authorizeUrl.searchParams.set("resource", `${base}/api/mcp`);

  console.log(`\n${failures === 0 ? "Pass 1 clean." : `Pass 1 had ${failures} failure(s).`}\n`);
  console.log("Open this, approve, then copy the ?code= value from the redirect:\n");
  console.log(`  ${authorizeUrl}\n`);
  console.log("Then run:  node scripts/mcp-smoke.mjs --code <code>\n");
  process.exit(failures === 0 ? 0 : 1);
}

async function passTwo(code) {
  if (!saved.clientId || !saved.verifier) {
    console.error("No saved state. Run pass 1 first (--base <host>).");
    process.exit(2);
  }
  console.log(`\nMCP gateway probe (pass 2) against ${base}\n`);

  console.log("Token exchange");
  const exchange = () =>
    json(`${base}/api/mcp/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: saved.clientId,
        redirect_uri: saved.redirectUri,
        code_verifier: saved.verifier,
        resource: `${base}/api/mcp`,
      }),
    });

  const tokenResponse = await exchange();
  check("code exchanges for a token", tokenResponse.response.ok, JSON.stringify(tokenResponse.body));
  const accessToken = tokenResponse.body?.access_token;
  if (!accessToken) process.exit(1);
  check("refresh token issued", Boolean(tokenResponse.body.refresh_token));

  // Replaying the same code must now fail -- one-time use, verified live.
  const replay = await exchange();
  check("replaying the code is rejected", replay.body?.error === "invalid_grant");

  const rpc = async (method, params) =>
    json(`${base}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, ...(params ? { params } : {}) }),
    });

  console.log("\nMCP session");
  const initialize = await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "smoke", version: "1" },
  });
  check(
    "initialize returns a protocol version",
    Boolean(initialize.body?.result?.protocolVersion),
    initialize.body?.result?.protocolVersion,
  );

  const list = await rpc("tools/list");
  const tools = (list.body?.result?.tools ?? []).map((tool) => tool.name);
  check("tools/list returns tools", tools.length > 0, tools.join(", "));
  check("exposes ChatGPT's required `search` tool", tools.includes("search"));
  check("exposes ChatGPT's required `fetch` tool", tools.includes("fetch"));

  const call = await rpc("tools/call", { name: "sentinel_list_tasks", arguments: { limit: 3 } });
  check(
    "tools/call succeeds against live data",
    call.body?.result?.isError === false,
    String(call.body?.result?.content?.[0]?.text ?? "").slice(0, 160),
  );

  const search = await rpc("tools/call", { name: "search", arguments: { query: "sentinel" } });
  check("search returns a results array", Array.isArray(search.body?.result?.structuredContent?.results));

  console.log("\nScope enforcement");
  const write = await rpc("tools/call", { name: "sentinel_create_task", arguments: { title: "smoke probe" } });
  const wasGranted = tools.includes("sentinel_create_task");
  check(
    wasGranted ? "tasks.write was granted, so create succeeds" : "ungranted tasks.write is refused as a tool error",
    wasGranted ? write.body?.result?.isError === false : write.body?.result?.isError === true,
  );

  console.log(`\n${failures === 0 ? "All live checks passed." : `${failures} live check(s) failed.`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

const code = flag("code");
await (code ? passTwo(code) : passOne());
