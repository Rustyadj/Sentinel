import { z } from "zod";

/**
 * The only CustomModule columns a caller may set. `id`, `moduleId`, `href`,
 * `config` and the timestamps are server-owned: `moduleId` is the public route
 * key (/modules/[id]) and must not be re-pointed by an update.
 */
const CONTENT_TYPES = ["markdown", "iframe"] as const;

const fields = {
  label: z.string().trim().min(1).max(80),
  description: z.string().max(500),
  icon: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9]+$/, "icon must be a lucide icon name"),
  contentType: z.enum(CONTENT_TYPES),
  content: z.string().max(100_000),
  enabled: z.boolean(),
  order: z.number().int().min(0).max(10_000),
};

/**
 * An iframe module embeds `content` as its src, so it must be an https URL.
 * Callers check the row as it will be stored (existing values merged with the
 * update), since an update may change `content` or `contentType` alone.
 */
export function iframeContentIsHttps(value: { contentType: string; content: string }) {
  if (value.contentType !== "iframe") return true;
  try {
    return new URL(value.content).protocol === "https:";
  } catch {
    return false;
  }
}
export const IFRAME_CONTENT_ERROR = "iframe content must be an https URL";

export const customModuleCreateSchema = z
  .object({
    label: fields.label,
    description: fields.description.optional(),
    icon: fields.icon.optional(),
    contentType: fields.contentType.optional(),
    content: fields.content.optional(),
    order: fields.order.optional(),
  })
  .strict();

export const customModuleUpdateSchema = z
  .object({
    label: fields.label.optional(),
    description: fields.description.optional(),
    icon: fields.icon.optional(),
    contentType: fields.contentType.optional(),
    content: fields.content.optional(),
    enabled: fields.enabled.optional(),
    order: fields.order.optional(),
  })
  .strict();

export type CustomModuleUpdate = z.infer<typeof customModuleUpdateSchema>;

export function invalidBody(error: z.ZodError) {
  return Response.json(
    { error: "Invalid request body", issues: error.issues.map(({ path, message }) => ({ path: path.join("."), message })) },
    { status: 400 },
  );
}
