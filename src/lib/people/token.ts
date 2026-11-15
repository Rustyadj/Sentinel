import { createHash } from "node:crypto";

/**
 * An invitation token is the credential. Only its hash is stored, so reading
 * the table never yields a working link. Kept in a module of its own, with no
 * imports, so the signup policy can use it without pulling in the people code.
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
