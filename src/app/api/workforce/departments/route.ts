import { z } from "zod";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { requireDepartmentEditor } from "@/lib/workforce/organization";

const id = z.string().trim().min(1).max(100);
const departmentSchema = z.strictObject({
  workspaceId: id,
  id: id.optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2_000),
  parentDepartmentId: id.nullable(),
});

export async function POST(request: Request) {
  const parsed = departmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid department details." }, { status: 400 });
  const { workspaceId, id, name, description, parentDepartmentId } = parsed.data;
  try {
    const { organizationId, userId } = await requireDepartmentEditor(workspaceId);
    const department = await db.$transaction(async (tx) => {
      // Serialize hierarchy changes so concurrent reparenting cannot create a cycle.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`workforce-departments:${organizationId}`})) IS NULL AS locked`;
      const departments = await tx.department.findMany({
        where: { organizationId },
        select: { id: true, parentDepartmentId: true },
      });
      const parents = new Map(departments.map((row) => [row.id, row.parentDepartmentId]));
      if (id && !parents.has(id)) throw new WorkspaceAccessError("Department not found.", 404);
      const seen = new Set(id ? [id] : []);
      let parent = parentDepartmentId;
      while (parent) {
        if (!parents.has(parent) || seen.has(parent)) {
          throw new WorkspaceAccessError("Select a parent in this organization outside the department's own hierarchy.", 400);
        }
        seen.add(parent);
        parent = parents.get(parent) ?? null;
      }
      const data = { name, description, parentDepartmentId };
      const saved = await (id
        ? tx.department.update({ where: { id, organizationId }, data })
        : tx.department.create({ data: { ...data, organizationId } }));
      await writeAuditLog({ userId, workspaceId, action: id ? "department.updated" : "department.created", entityType: "department", entityId: saved.id }, tx);
      return saved;
    });
    return Response.json({ department }, { status: id ? 200 : 201 });
  } catch (error) {
    if (error instanceof WorkspaceAccessError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
