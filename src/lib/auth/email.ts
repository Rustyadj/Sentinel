/**
 * Canonical form for an email address used as an account identifier.
 *
 * Email local-parts are technically case-sensitive per RFC 5321, but no real
 * provider treats them that way, and users do not distinguish them. Sentinel
 * learned this the expensive way: an account registered as
 * "Rustyadj@gmail.com" in June did not match the canonical lowercase address
 * Google returned in August, so the NextAuth jwt callback's upsert created a
 * second, separate identity for the same human. Their workspaces, agent
 * workspaces and knowledge ended up split across two user rows.
 *
 * Every lookup, upsert and create that keys on email must go through this, so
 * "Rustyadj@gmail.com" and "rustyadj@gmail.com" can never again resolve to two
 * accounts. The database has a matching case-insensitive unique index as the
 * backstop; this is what stops the situation arising in the first place.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Same, but tolerant of the loosely-typed values session/provider objects carry. */
export function normalizeEmailOrNull(email: unknown): string | null {
  if (typeof email !== "string") return null;
  const normalized = normalizeEmail(email);
  return normalized.length > 0 ? normalized : null;
}
