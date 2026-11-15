// The token Sentinel presents to an outside agent's server.
//
// It is derived, never stored: HMAC(server key, agent row id + version). So a
// read of the database yields nothing usable, there is no ciphertext to
// manage, and re-keying is a version bump. Sentinel issues the token rather
// than accepting one from the guest, so Sentinel never holds a credential that
// opens anything except this one agent's door to Sentinel's own calls.

import { createHmac, hkdfSync } from "node:crypto";

const INFO = "sentinel/project-agent-token/v1";
const PREFIX = "sntl_a2a_";

function serverKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not configured");
  return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32));
}

export function projectAgentToken(projectAgentRowId: string, tokenVersion: number): string {
  const mac = createHmac("sha256", serverKey()).update(`${projectAgentRowId}:${tokenVersion}`).digest("base64url");
  return `${PREFIX}${mac}`;
}
