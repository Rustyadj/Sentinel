import { expect, it, vi } from "vitest";
import { marketingPlan } from "@/lib/workforce/plan";
import { createWorkforceProvisioningAdapter, type WorkforceProvisionCommand, type WorkforceProvisionReceipt } from "@/lib/workforce/provisioning";

const command: WorkforceProvisionCommand = {
  workspaceId: "titan",
  requestId: "174a4391-98cd-447b-9541-bdd85457a639",
  actor: { kind: "agent", userId: "operator", agentId: "hermes-lisa" },
  plan: marketingPlan("Titan ICF"),
};

function receiptFor(input: WorkforceProvisionCommand): WorkforceProvisionReceipt {
  return {
    workspaceId: input.workspaceId,
    requestId: input.requestId,
    departmentId: "marketing",
    agents: input.plan.specialists.map(({ key, objectives }) => ({
      planKey: key, agentId: `agent-${key}`, runtimeId: `runtime-${key}`,
      objectiveIds: objectives.map((_, index) => `objective-${key}-${index}`),
      scheduleIds: objectives.flatMap(({ cadence }, index) => cadence === "once" ? [] : [`schedule-${key}-${index}`]),
      status: "active",
      missingCapabilities: key === "leads" ? [{ id: "crm", reason: "connection_missing" }] : [],
    })),
  };
}

it("passes the same command ID on retries and uses canonical agent, objective and schedule IDs", async () => {
  const core = { provision: vi.fn(async (input: WorkforceProvisionCommand) => receiptFor(input)) };
  const provision = createWorkforceProvisioningAdapter(core);
  const receipt = await provision(command);
  expect(await provision(command)).toEqual(receipt);
  expect(core.provision.mock.calls.map(([input]) => input.requestId)).toEqual([command.requestId, command.requestId]);
  expect(receipt.agents).toHaveLength(5);
  expect(receipt.agents.find(({ planKey }) => planKey === "reporting")?.scheduleIds).toEqual(["schedule-reporting-0"]);
  expect(receipt.agents.find(({ planKey }) => planKey === "leads")?.missingCapabilities).toEqual([{ id: "crm", reason: "connection_missing" }]);
});

it("rejects foreign, partial, or duplicated provisioning receipts", async () => {
  const receipt = receiptFor(command);
  for (const wrong of [
    { ...receipt, workspaceId: "other-tenant" },
    { ...receipt, agents: receipt.agents.slice(1) },
    { ...receipt, agents: receipt.agents.map((agent) => ({ ...agent, agentId: "duplicate" })) },
  ]) {
    const provision = createWorkforceProvisioningAdapter({ provision: async () => wrong });
    await expect(provision(command)).rejects.toThrow("different workforce");
  }
});
