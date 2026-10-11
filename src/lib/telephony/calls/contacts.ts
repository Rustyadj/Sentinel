import { db } from "@/lib/db";
import { isE164, normalizeE164 } from "../telnyx/config";
import { CallPolicyError } from "./policy";

export interface ResolvedDestination {
  number: string;
  contactName: string | null;
}

/**
 * Accepts either a phone number or a contact name. A name must match exactly
 * one of the user's callable contacts: guessing between "John Smith" and "John
 * Deere" and dialing the wrong one is worse than asking.
 */
export async function resolveDestination(userId: string, target: string): Promise<ResolvedDestination> {
  const trimmed = target.trim();
  if (/^[+\d][\d\s().-]{5,}$/.test(trimmed)) {
    const number = normalizeE164(trimmed);
    if (!isE164(number)) throw new CallPolicyError("The destination is not a valid E.164 phone number.", "invalid_number");
    const known = await db.phoneContact.findUnique({ where: { userId_number: { userId, number } } });
    if (known && !known.callable) throw new CallPolicyError(`${known.name} is not enabled for calling.`, "destination_blocked");
    return { number, contactName: known?.name ?? null };
  }

  const matches = await db.phoneContact.findMany({
    where: { userId, name: { contains: trimmed, mode: "insensitive" } },
    take: 5,
  });
  const exact = matches.filter((c) => c.name.toLowerCase() === trimmed.toLowerCase());
  const pool = exact.length > 0 ? exact : matches;
  if (pool.length === 0) throw new CallPolicyError(`No contact matches "${trimmed}". Provide a phone number.`, "invalid_number");
  if (pool.length > 1) {
    throw new CallPolicyError(`"${trimmed}" matches ${pool.map((c) => c.name).join(", ")}. Which one?`, "invalid_number");
  }
  const contact = pool[0];
  if (!contact.callable) throw new CallPolicyError(`${contact.name} is not enabled for calling.`, "destination_blocked");
  return { number: contact.number, contactName: contact.name };
}
