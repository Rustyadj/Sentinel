import { z } from "zod";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const label = z.string().trim().min(1).max(120);
const cell = z.string().max(500);
const component = z.discriminatedUnion("type", [
  z.strictObject({ id, type: z.literal("text"), text: z.string().max(5_000) }),
  z.strictObject({ id, type: z.literal("metrics"), values: z.array(z.strictObject({ label, value: cell })).min(1).max(12) }),
  z.strictObject({
    id, type: z.literal("table"), caption: label,
    columns: z.array(label).min(1).max(10),
    rows: z.array(z.array(cell).max(10)).max(100),
  }),
  z.strictObject({
    id, type: z.literal("barChart"), caption: label,
    values: z.array(z.strictObject({ label, value: z.number().finite().nonnegative() })).min(1).max(20),
  }),
  z.strictObject({ id, type: z.literal("action"), label, action: z.enum(["pause", "resume", "stop", "retry_step"]), objectiveId: id, stepKey: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/).optional() }),
]);

export const surfaceSchema = z.strictObject({
  version: z.literal(1),
  title: label,
  components: z.array(component).max(30),
}).superRefine(({ components }, ctx) => {
  const seen = new Set<string>();
  components.forEach((item, i) => {
    if (seen.has(item.id)) ctx.addIssue({ code: "custom", path: ["components", i, "id"], message: "Duplicate component ID." });
    seen.add(item.id);
    if (item.type === "table" && item.rows.some((row) => row.length !== item.columns.length)) {
      ctx.addIssue({ code: "custom", path: ["components", i, "rows"], message: "Table rows must match the column count." });
    }
    if (item.type === "action" && (item.action === "retry_step") !== Boolean(item.stepKey)) {
      ctx.addIssue({ code: "custom", path: ["components", i, "stepKey"], message: "Only retry actions require a step key." });
    }
  });
});

export type Surface = z.infer<typeof surfaceSchema>;
export type SurfaceAction = Extract<Surface["components"][number], { type: "action" }>;

export function objectiveActionKey(action: Pick<SurfaceAction, "action" | "objectiveId" | "stepKey">) {
  return JSON.stringify([action.objectiveId, action.action, action.stepKey ?? null]);
}
