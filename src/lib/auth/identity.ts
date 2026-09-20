import { db } from "@/lib/db";
import { normalizeEmail } from "./email";

/**
 * Email is an identity key, so every lookup must see case-only duplicates.
 * Returning all matches lets callers fail closed instead of silently choosing
 * whichever row PostgreSQL happens to return.
 */
export async function findEmailIdentities(email: string) {
  return db.user.findMany({
    where: { email: { equals: normalizeEmail(email), mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
  });
}

/** Credentials may select a row only when exactly one matching identity owns a password. */
export async function findCredentialIdentity(email: string) {
  const candidates = (await findEmailIdentities(email)).filter((candidate) => Boolean(candidate.passwordHash));
  return candidates.length === 1 ? candidates[0] : null;
}
