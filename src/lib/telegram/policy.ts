import { readFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const AGENTS = { lisa: "hermes-lisa", nathan2: "hermes-nathan2" } as const;
export class TelegramError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); this.name = "TelegramError"; }
}
const id = z.number().int().safe().transform(String);
const file = z.object({ file_id: z.string().min(1).max(512), file_unique_id: z.string().max(512).optional(), file_size: z.number().int().safe().nonnegative().optional(), file_name: z.string().max(255).optional(), mime_type: z.string().max(200).optional() });
export const updateSchema = z.object({
  update_id: id,
  message: z.object({
    message_id: id, from: z.object({ id, is_bot: z.literal(false) }),
    chat: z.object({ id, type: z.literal("private") }),
    text: z.string().max(12_000).optional(), caption: z.string().max(12_000).optional(),
    voice: file.optional(), audio: file.optional(), document: file.optional(), video: file.optional(),
    photo: z.array(file).max(10).optional(),
    reply_to_message: z.object({ message_id: id }).optional(),
    // Forwarded sender claims are never used as authenticated identity.
  }),
});
export type TelegramUpdateInput = z.infer<typeof updateSchema>;
export function validSecret(actual: string | null, expected: string | undefined) {
  if (!actual || !expected || !/^[A-Za-z0-9_-]{16,256}$/.test(expected)) return false;
  const hash = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(hash(actual), hash(expected));
}
export function expectedAgent(key: string, agentId: string) {
  if (!(key in AGENTS) || AGENTS[key as keyof typeof AGENTS] !== agentId) throw new TelegramError("agent_binding_mismatch", 409);
}
export function attachments(update: TelegramUpdateInput) {
  const m = update.message;
  return [m.voice && { ...m.voice, kind: "voice" }, m.audio && { ...m.audio, kind: "audio" }, m.document && { ...m.document, kind: "document" }, m.video && { ...m.video, kind: "video" }, m.photo?.length && { ...m.photo[m.photo.length - 1], kind: "photo" }].filter((v): v is z.infer<typeof file> & { kind: string } => Boolean(v));
}
/** Conservative UTF-16 limit without splitting a surrogate pair. */
export function chunks(text: string): string[] {
  const points = Array.from(text || "The agent completed without a text response.");
  const result: string[] = [];
  for (let i = 0; i < points.length; i += 2000) result.push(points.slice(i, i + 2000).join(""));
  if (result.length > 30) result[29] += "\nFull response continues in Sentinel.";
  return result.slice(0, 30);
}
export function envSecret(name: string) {
  if (!/^TELEGRAM_(LISA|NATHAN2)_(BOT_TOKEN|WEBHOOK_SECRET)$/.test(name)) throw new TelegramError("invalid_secret_reference", 503);
  const file = process.env[`${name}_FILE`];
  let value: string | undefined;
  try { value = file ? readFileSync(file, "utf8").trim() : process.env[name]?.trim(); } catch { throw new TelegramError("secret_not_readable", 503); }
  if (!value) throw new TelegramError("secret_not_configured", 503);
  return value;
}
