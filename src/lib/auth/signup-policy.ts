import { db } from "@/lib/db";
import { hashInvitationToken } from "@/lib/people/token";
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
 *   an invitation              a link issued by someone entitled to invite,
 *                              unspent, unexpired, and issued to this address
 *                              if it names one (see lib/people/invitations.ts)
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

export async function isSignupAllowed(email: string, invitationToken?: string | null): Promise<boolean> {
  if (process.env.SENTINEL_OPEN_SIGNUP === "true") return true;
  if (emailMatchesAllowlist(email)) return true;
  if (invitationToken && (await invitationAdmitsSignup(email, invitationToken))) return true;
  return (await db.user.count()) === 0;
}

/**
 * Whether `token` is a live invitation this address may use. This only says
 * the account may be created; the caller still has to spend the invitation
 * (acceptInvitation), which is what makes a link admit one person once.
 */
async function invitationAdmitsSignup(email: string, token: string): Promise<boolean> {
  if (token.length < 20) return false;
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: { email: true, acceptedAt: true, revokedAt: true, expiresAt: true },
  });
  if (!invitation || invitation.acceptedAt || invitation.revokedAt || invitation.expiresAt <= new Date()) return false;
  return !invitation.email || normalizeEmail(invitation.email) === normalizeEmail(email);
}

export const SIGNUP_CLOSED_MESSAGE = "Account registration is by invitation only.";
