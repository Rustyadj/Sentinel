import { z } from "zod";
import { workforcePlanSchema } from "./plan";

const id = z.string().trim().min(1).max(120);
const actorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user"), userId: id }),
  z.strictObject({ kind: z.literal("agent"), userId: id, agentId: id }),
]);

const commandSchema = z.strictObject({
  workspaceId: id,
  requestId: z.uuid(),
  actor: actorSchema,
  plan: workforcePlanSchema,
});

const receiptSchema = z.strictObject({
  requestId: z.uuid(),
  workspaceId: id,
  departmentId: id,
  agents: z.array(z.strictObject({
    planKey: id,
    agentId: id,
    runtimeId: id,
    objectiveIds: z.array(id),
    scheduleIds: z.array(id),
    status: z.enum(["active", "paused", "blocked"]),
    missingCapabilities: z.array(z.strictObject({
      id, reason: z.enum(["connection_missing", "not_authorized", "provider_unavailable"]),
    })),
  })),
});

export type WorkforceProvisionCommand = z.infer<typeof commandSchema>;
export type WorkforceProvisionReceipt = z.infer<typeof receiptSchema>;

/**
 * The injected canonical operation owns actor verification, durable
 * idempotency and all identity, objective and scheduling writes.
 */
export interface CanonicalWorkforceProvisioner {
  provision(command: WorkforceProvisionCommand): Promise<WorkforceProvisionReceipt>;
}

export function createWorkforceProvisioningAdapter(core: CanonicalWorkforceProvisioner) {
  return async (input: WorkforceProvisionCommand): Promise<WorkforceProvisionReceipt> => {
    const command = commandSchema.parse(input);
    const receipt = receiptSchema.parse(await core.provision(command));
    const requested = new Set(command.plan.specialists.map(({ key }) => key));
    const returned = new Set(receipt.agents.map(({ planKey }) => planKey));
    const returnedIds = new Set(receipt.agents.map(({ agentId }) => agentId));
    if (command.workspaceId !== receipt.workspaceId || command.requestId !== receipt.requestId
      || returned.size !== requested.size || returnedIds.size !== receipt.agents.length
      || receipt.agents.length !== requested.size || [...returned].some((key) => !requested.has(key))) {
      throw new Error("Canonical provisioning returned a receipt for a different workforce.");
    }
    return receipt;
  };
}
