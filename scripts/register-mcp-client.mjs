#!/usr/bin/env node
/**
 * Register a pre-registered OAuth client for the Sentinel MCP gateway.
 *
 * The MCP authorization spec lists three ways a client gets a client_id:
 * Client ID Metadata Documents, pre-registration, or Dynamic Client
 * Registration (which the spec marks MAY and deprecated). OpenAI's connector
 * docs state that "if static credentials are provided, then they will be
 * used", so pre-registration is the supported path and Sentinel needs no DCR
 * endpoint.
 *
 * ChatGPT generates a unique callback URL per connector
 * (https://chatgpt.com/connector/oauth/{callback_id}; older published apps use
 * https://chatgpt.com/connector_platform_oauth_redirect). That value is only
 * visible in the ChatGPT UI, so it must be passed in here -- it is never
 * guessed, and never wildcarded.
 *
 * The client secret is generated here, printed once, and stored only as a
 * SHA-256 hash. It is never written to a file or committed.
 *
 * Usage:
 *   node scripts/register-mcp-client.mjs \
 *     --redirect-uri "https://chatgpt.com/connector/oauth/abc123" \
 *     [--name "ChatGPT"] [--user <userId>] [--scopes "a b c"] [--public]
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const PG = "sentinel-os-postgres-1";
const ALL_SCOPES = ["sentinel.read", "sentinel.tasks.read", "sentinel.tasks.write", "sentinel.memory.read"];

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const redirectUri = flag("redirect-uri");
const name = flag("name", "ChatGPT");
const userId = flag("user");
const scopes = (flag("scopes") ?? ALL_SCOPES.join(" ")).split(/\s+/).filter(Boolean);
// A public client authenticates with PKCE alone. ChatGPT supports both; a
// confidential client (the default here) is stronger, so secrets stay the norm.
const isPublic = has("public");

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

if (!redirectUri) fail("--redirect-uri is required (copy the exact value ChatGPT shows you).");
if (!userId) fail("--user is required; Sentinel never guesses or hardcodes an OAuth owner identity.");

let parsed;
try {
  parsed = new URL(redirectUri);
} catch {
  fail(`--redirect-uri is not a valid URL: ${redirectUri}`);
}
if (parsed.protocol !== "https:") fail("redirect_uri must be https.");
if (parsed.hash) fail("redirect_uri must not contain a fragment.");
if (redirectUri.includes("*")) fail("wildcard redirect URIs are not allowed.");

const unknown = scopes.filter((s) => !ALL_SCOPES.includes(s));
if (unknown.length) fail(`unknown scope(s): ${unknown.join(", ")}`);

const sql = (statement) => {
  const out = execFileSync("docker", ["exec", PG, "psql", "-q", "-U", "hermes", "-d", "hermesos", "-tAc", statement], {
    encoding: "utf8",
  });
  return out.split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
};

const user = sql(`select email from users where id = '${userId}';`);
if (!user) fail(`no user with id ${userId}`);

const clientId = `chatgpt-${randomBytes(8).toString("hex")}`;
const secret = isPublic ? null : randomBytes(32).toString("base64url");
const secretHash = secret ? createHash("sha256").update(secret).digest("base64url") : null;

sql(
  `insert into external_clients ("id","clientId","name","clientSecretHash","redirectUris","allowedScopes","enabled","createdByUserId","createdAt","updatedAt")
   values (gen_random_uuid()::text, '${clientId}', '${name.replace(/'/g, "''")}', ${secretHash ? `'${secretHash}'` : "null"},
           '{"${redirectUri}"}', '{${scopes.join(",")}}', true, '${userId}', now(), now());`,
);

console.log(`
Registered Sentinel MCP OAuth client
------------------------------------
  Client ID      ${clientId}
  Client secret  ${secret ?? "(public client -- PKCE only)"}
  Redirect URI   ${redirectUri}
  Scopes         ${scopes.join(" ")}
  Owner          ${user}

The secret is shown once and stored only as a SHA-256 hash. Paste it into
ChatGPT now; it cannot be recovered. To revoke:

  docker exec ${PG} psql -U hermes -d hermesos \\
    -c "update external_clients set enabled = false where \\"clientId\\" = '${clientId}';"
`);
