import { db } from "@/lib/db";
import { normalizeEmail } from "./email";

/**
 * Who may create a *new* Sentinel account. Existing accounts are never
 * affected — this is consulted only where a user row would be created:
 * credentials registration, a first OAuth sign-in, and requireUser()'s
 * session backfill.
 *
 * Closed by default. A new account is not inert: listWorkspaces() enrols every
 * user as a Member of the shared default workspaces, which exposes their
 * projects, tasks, documents, approvals and agent computers. So account
 * creation is an authorization decision, not a convenience.
 *
 *   SENTINEL_SIGNUP_ALLOWLIST  comma-separated emails and/or "@domain" entries
 *   SENTINEL_OPEN_SIGNUP=true  anyone may sign up (explicit opt-in)
 *
 * The very first account on an empty instance is always allowed, so a fresh
 * install can be bootstrapped without configuration.
 */
export function signupAllowlist(): string[] {
  return (process.env.SENTINEL_SIGNUP_ALLOWLIST ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

export function emailMatchesAllowlist(email: string, allowlist = signupAllowlist()): boolean {
  const normalized = normalizeEmail(email);
  const domain = normalized.slice(normalized.lastIndexOf("@"));
  return allowlist.some((entry) => (entry.startsWith("@") ? entry === domain : entry === normalized));
}

export async function isSignupAllowed(email: string): Promise<boolean> {
  if (process.env.SENTINEL_OPEN_SIGNUP === "true") return true;
  if (emailMatchesAllowlist(email)) return true;
  return (await db.user.count()) === 0;
}

export const SIGNUP_CLOSED_MESSAGE = "Account registration is by invitation only.";
