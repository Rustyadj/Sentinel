import type { SystemOneConfig } from "@/lib/system-one/config";
import { resolveSystemOneConfig } from "@/lib/system-one/config";
import type { ReadOnlyToolDescriptor, SystemOneDecision } from "@/lib/system-one/types";

export const testConfig = (env: Record<string, string> = {}): SystemOneConfig =>
  resolveSystemOneConfig({ SYSTEM_ONE_MODE: "active", OPENROUTER_API_KEY: "test-key", ...env });

/** A MobileOps-shaped read-only tool with no required arguments. */
export const statusTool: ReadOnlyToolDescriptor = {
  id: "mobileops.operational_status",
  connector: "mobileops",
  name: "operational_status",
  description: "Current operational status: crews, dispatches, equipment out",
  enumArguments: {},
  requiredArguments: [],
  fastPathEligible: true,
};

export const bucketTool: ReadOnlyToolDescriptor = {
  id: "mobileops.inventory_capacity",
  connector: "mobileops",
  name: "inventory_capacity",
  description: "Inventory capacity by bucket",
  enumArguments: { bucket: ["available", "rented", "repair"] },
  requiredArguments: ["bucket"],
  fastPathEligible: true,
};

/** Requires a free-text argument System 1 cannot fill. */
export const searchTool: ReadOnlyToolDescriptor = {
  id: "mobileops.inventory_search",
  connector: "mobileops",
  name: "inventory_search",
  description: "Search inventory by free-text query",
  enumArguments: {},
  requiredArguments: ["query"],
  fastPathEligible: false,
};

/** A decision that should fast-path `statusTool` under default thresholds. */
export function confidentToolDecision(overrides: Partial<SystemOneDecision> = {}): SystemOneDecision {
  return {
    intent: "status_query",
    route: "tool_read",
    needsMemory: 0.02,
    needsTool: 0.98,
    needsSearch: 0.01,
    needsSystem2: 0.03,
    needsClarification: 0.02,
    readOnly: 0.99,
    complexity: 0.3,
    urgency: 0.2,
    suggestedTool: statusTool.id,
    suggestedToolArguments: {},
    suggestedModel: "gpt-5.6-luna",
    confidence: 0.95,
    confidences: { intent: 0.93, route: 0.95, tool: 0.94 },
    ...overrides,
  };
}
