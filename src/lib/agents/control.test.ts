import { describe, expect, it } from "vitest";
import { canEditConfig, canRestartAgent } from "./policy";
import { getContainerLogs, restartContainer } from "./processControl";

describe("agent control authorization and command allowlists", () => {
  it("restricts mutation actions to owner and admin roles", () => {
    expect(canEditConfig("owner")).toBe(true);
    expect(canEditConfig("admin")).toBe(true);
    expect(canEditConfig("member")).toBe(false);
    expect(canRestartAgent("member")).toBe(false);
  });

  it("rejects non-registry identifiers before invoking Docker", async () => {
    await expect(getContainerLogs("../../bin/sh", 100)).rejects.toThrow("allowlisted");
    await expect(restartContainer("hermes-lisa;whoami")).rejects.toThrow("allowlisted");
  });
});
