#!/usr/bin/env node
/**
 * Live production test of the refresh_token grant against the deployed OAuth
 * server -- not a unit test, real HTTP against https://sentinel…/api/…
 *
 * Walks the exact path a real MCP client takes: dynamic registration, an
 * authorization code minted the way the consent route mints it after
 * requireUser(), PKCE token exchange, MCP calls, a refresh, MCP calls again on
 * the rotated token WITHOUT any further consent, and finally a replay of the
 * spent refresh token to prove it is rejected and the family is revoked.
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE = "https://sentinel.srv1427612.hstgr.cloud";
const PG = "sentinel-os-postgres-1";
const USER_ID = "cmqyvtod10000jv013gcp11n5";
const RU = "http://127.0.0.1:41999/callback/refreshprobe";
const ALL = ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"];

const sha = (v) => createHash("sha256").update(v).digest("base64url");
const opaque = (n = 32) => randomBytes(n).toString("base64url");

const sql = (s) =>
  execFileSync("docker", ["exec", PG, "psql", "-q", "-U", "hermes", "-d", "hermesos", "-tAc", s], {
    encoding: "utf8",
  })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)[0] ?? "";

let pass = 0;
let fail = 0;
const failed = [];
const check = (label, ok, detail = "") => {
  ok ? pass++ : (fail++, failed.push(label));
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` -- ${detail}` : ""}`);
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
  return { status: r.status, body, text };
}

const form = (fields) =>
  http("/api/integrations/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields),
  });

async function mcp(token, method, params) {
  const r = await http("/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, ...(params ? { params } : {}) }),
  });
  if (typeof r.body === "string" && r.body.includes("data:")) {
    const line = r.body.split("\n").find((l) => l.startsWith("data:"));
    if (line) {
      try {
        r.body = JSON.parse(line.slice(5).trim());
      } catch {
        /* leave */
      }
    }
  }
  return r;
}

const cleanup = [];

async function main() {
  console.log(`\nRefresh-token live probe -- ${BASE}\n`);

  console.log("1. Discovery advertises the grant");
  const asm = await http("/.well-known/oauth-authorization-server");
  check(
    "grant_types_supported includes refresh_token",
    (asm.body?.grant_types_supported ?? []).includes("refresh_token"),
    JSON.stringify(asm.body?.grant_types_supported),
  );

  console.log("\n2. Dynamic client registration requesting refresh_token");
  const reg = await http("/api/integrations/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "refresh-probe",
      redirect_uris: [RU],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
      response_types: ["code"],
      application_type: "native",
    }),
  });
  check("registration succeeds", reg.status === 201, `status ${reg.status}`);
  check(
    "refresh_token grant is granted back",
    (reg.body?.grant_types ?? []).includes("refresh_token"),
    JSON.stringify(reg.body?.grant_types),
  );
  const clientId = reg.body?.client_id;
  if (!clientId) return;
  const dbId = sql(`select id from external_clients where "clientId"='${clientId}';`);
  cleanup.push(dbId);

  console.log("\n3. Authorization code + PKCE exchange");
  const verifier = opaque();
  const code = opaque();
  sql(
    `insert into oauth_authorization_codes ("id","codeHash","externalClientId","userId","redirectUri","scopes","codeChallenge","codeChallengeMethod","expiresAt","createdAt")
     values (gen_random_uuid()::text,'${sha(code)}','${dbId}','${USER_ID}','${RU}','{${ALL.join(",")}}','${sha(verifier)}','S256',now()+interval '5 minutes',now());`,
  );
  const first = await form({
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: RU,
    code_verifier: verifier,
  });
  check("token exchange succeeds", first.status === 200, `status ${first.status}`);
  check("access_token issued", Boolean(first.body?.access_token));
  check("refresh_token issued", Boolean(first.body?.refresh_token));
  check("scope preserved", (first.body?.scope ?? "").split(" ").sort().join() === [...ALL].sort().join());
  const accessV1 = first.body?.access_token;
  const refreshV1 = first.body?.refresh_token;
  if (!refreshV1) return;

  console.log("\n4. MCP works on the original access token");
  const init = await mcp(accessV1, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "refresh-probe", version: "1" },
  });
  check("initialize succeeds", init.status === 200 && Boolean(init.body?.result));
  const list1 = await mcp(accessV1, "tools/list");
  const tools1 = (list1.body?.result?.tools ?? []).map((t) => t.name);
  check("tools/list returns 8 tools", tools1.length === 8, `${tools1.length}`);

  console.log("\n5. Refresh -- no interactive consent");
  const refreshed = await form({ grant_type: "refresh_token", refresh_token: refreshV1, client_id: clientId });
  check("refresh succeeds", refreshed.status === 200, `status ${refreshed.status} ${JSON.stringify(refreshed.body).slice(0, 120)}`);
  const accessV2 = refreshed.body?.access_token;
  const refreshV2 = refreshed.body?.refresh_token;
  check("new access token issued", Boolean(accessV2) && accessV2 !== accessV1);
  check("refresh token ROTATED (new value)", Boolean(refreshV2) && refreshV2 !== refreshV1);
  check("scope preserved across refresh", (refreshed.body?.scope ?? "").split(" ").sort().join() === [...ALL].sort().join());

  console.log("\n6. MCP continues on the rotated token, still no consent");
  const list2 = await mcp(accessV2, "tools/list");
  const tools2 = (list2.body?.result?.tools ?? []).map((t) => t.name);
  check("tools/list works with the refreshed token", list2.status === 200 && tools2.length === 8, `${tools2.length} tools`);
  const call = await mcp(accessV2, "tools/call", { name: "sentinel.list_agents", arguments: {} });
  check("tools/call works with the refreshed token", call.status === 200 && call.body?.result?.isError !== true);

  console.log("\n7. User binding preserved across rotation");
  // Compare against the user the ORIGINAL token was bound to rather than a
  // hardcoded address -- that is the property that matters, and it does not
  // depend on which of the similarly-named user rows the probe ran as.
  const userBefore = sql(`select "userId" from oauth_access_tokens where "tokenHash"='${sha(accessV1)}';`);
  const userAfter = sql(`select "userId" from oauth_access_tokens where "tokenHash"='${sha(accessV2)}';`);
  check(
    "refreshed access token is bound to the same user as the original",
    userAfter !== "" && userAfter === userBefore && userAfter === USER_ID,
    `${userBefore} -> ${userAfter}`,
  );
  const clientAfter = sql(`select "externalClientId" from oauth_access_tokens where "tokenHash"='${sha(accessV2)}';`);
  check("refreshed access token is bound to the same client", clientAfter === dbId, clientAfter);
  const scopesAfter = sql(`select array_to_string(scopes,' ') from oauth_access_tokens where "tokenHash"='${sha(accessV2)}';`);
  check("refreshed access token carries the same scopes", scopesAfter.split(" ").sort().join() === [...ALL].sort().join(), scopesAfter);

  console.log("\n8. Replay of the spent refresh token");
  const replay = await form({ grant_type: "refresh_token", refresh_token: refreshV1, client_id: clientId });
  check("replay is rejected", replay.status === 400 && replay.body?.error === "invalid_grant", JSON.stringify(replay.body));
  check("replay mints no token", !replay.body?.access_token && !replay.body?.refresh_token);

  const revoked = sql(`select count(*) from oauth_refresh_tokens where "externalClientId"='${dbId}' and "revokedAt" is null;`);
  check("whole family revoked after replay", Number(revoked) === 0, `${revoked} unrevoked remain`);

  const afterReplay = await form({ grant_type: "refresh_token", refresh_token: refreshV2, client_id: clientId });
  check("the rotated successor is dead too", afterReplay.status === 400, `status ${afterReplay.status}`);

  const accessAfter = await mcp(accessV2, "tools/list");
  check("access token minted by the family is revoked as well", accessAfter.status === 401, `status ${accessAfter.status}`);

  console.log("\n9. Negative cases");
  const other = await http("/api/integrations/oauth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "refresh-probe-other",
      redirect_uris: [RU],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    }),
  });
  cleanup.push(sql(`select id from external_clients where "clientId"='${other.body.client_id}';`));
  const wrongClient = await form({
    grant_type: "refresh_token",
    refresh_token: refreshV1,
    client_id: other.body.client_id,
  });
  check("a different client cannot use the token", wrongClient.status === 400, JSON.stringify(wrongClient.body).slice(0, 90));

  const garbage = await form({ grant_type: "refresh_token", refresh_token: opaque(), client_id: clientId });
  check("unknown refresh token rejected", garbage.status === 400 && garbage.body?.error === "invalid_grant");

  const badGrant = await form({ grant_type: "password", client_id: clientId });
  check(
    "unsupported grant_type rejected",
    badGrant.status === 400 && badGrant.body?.error === "unsupported_grant_type",
    badGrant.body?.error,
  );

  console.log("\n10. Auditing");
  const audits = sql(
    `select string_agg(distinct action, ',') from audit_logs where action like 'mcp.refresh_token%' and "createdAt" > now() - interval '5 minutes';`,
  );
  check("refresh audit events recorded", audits.includes("rotated") && audits.includes("replay_detected"), audits);
  const leak = sql(
    `select count(*) from audit_logs where "createdAt" > now() - interval '5 minutes' and details::text like '%${refreshV1.slice(0, 20)}%';`,
  );
  check("no plaintext refresh token in audit details", Number(leak) === 0, `${leak} rows`);

  console.log(`\n${fail === 0 ? "ALL REFRESH CHECKS PASSED" : `${fail} FAILED`}  (${pass} passed, ${fail} failed)`);
  if (fail) console.log(`Failed: ${failed.join("; ")}`);
}

main()
  .catch((e) => {
    console.error("aborted:", e);
    fail++;
  })
  .finally(() => {
    for (const id of cleanup) {
      try {
        if (id) sql(`delete from external_clients where id='${id}';`);
      } catch {
        /* best effort */
      }
    }
    console.log(`\nCleaned up ${cleanup.length} probe client(s).\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
