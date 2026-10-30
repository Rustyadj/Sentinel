import { describe, expect, it } from "vitest";
import { assessRisk } from "./approval-gate";
import {
  classifyTaskAction, displayRiskFloor, escalateRisk, guardianRiskFloor, requiresHumanApproval, workspaceApprovalAllowlist,
} from "./action-policy";

describe("classifyTaskAction / requiresHumanApproval", () => {
  it("keyword-gating bypass: 'Tidy config' / 'update the env loader and push to main' on claude-code requires approval", () => {
    const task = {
      title: "Tidy config",
      description: "update the env loader and push to main",
      capabilities: [] as string[],
      fileScope: [] as string[],
    };
    // The old keyword gate scored this low and skipped approval entirely.
    expect(assessRisk(`${task.title} ${task.description} ${task.fileScope.join(" ")}`)).toBe("low");
    const cls = classifyTaskAction(task, { kind: "claude-code" });
    expect(cls).toBe("write");
    expect(requiresHumanApproval(cls)).toBe(true);
  });

  it("gates a claude-code task with an innocuous title and no risky keywords", () => {
    const cls = classifyTaskAction({ capabilities: ["testing"], fileScope: [] }, { kind: "claude-code" });
    expect(requiresHumanApproval(cls)).toBe(true);
  });

  it("gates every coding runtime and any file scope", () => {
    for (const kind of ["claude-code", "codex", "gemini", "hermes"]) {
      expect(classifyTaskAction({ capabilities: ["research"], fileScope: [] }, { kind })).toBe("write");
    }
    expect(classifyTaskAction({ capabilities: ["research"], fileScope: ["docs/**"] }, { kind: "hermes", shellCapable: false })).toBe("write");
  });

  it("exempts a read-only capability on a read-only runtime", () => {
    const cls = classifyTaskAction({ capabilities: ["research"], fileScope: [] }, { kind: "hermes", shellCapable: false });
    expect(cls).toBe("read");
    expect(requiresHumanApproval(cls)).toBe(false);
  });

  it("fails closed on an unknown runtime, a missing runtime, or missing/unknown capabilities", () => {
    expect(classifyTaskAction({ capabilities: ["research"], fileScope: [] }, { kind: "mystery-runtime" })).toBe("write");
    expect(classifyTaskAction({ capabilities: ["research"], fileScope: [] }, null)).toBe("write");
    expect(classifyTaskAction({ capabilities: [], fileScope: [] }, { kind: "hermes", shellCapable: false })).toBe("write");
    expect(classifyTaskAction({ capabilities: ["research", "telepathy"], fileScope: [] }, { kind: "hermes", shellCapable: false })).toBe("write");
    expect(requiresHumanApproval("write")).toBe(true);
  });

  it("classifies devops as deploy", () => {
    expect(classifyTaskAction({ capabilities: ["devops"], fileScope: [] }, { kind: "codex" })).toBe("deploy");
  });

  it("labels a read task mentioning 'production' high risk and keeps it gated", () => {
    const text = "check the production dashboard numbers";
    const cls = classifyTaskAction({ capabilities: ["research"], fileScope: [] }, { kind: "codex" });
    expect(escalateRisk(displayRiskFloor(cls), assessRisk(text))).toBe("high");
    expect(escalateRisk(guardianRiskFloor(cls), assessRisk(text))).toBe("high");
    expect(requiresHumanApproval(cls)).toBe(true);
  });
});

describe("workspace allowlist", () => {
  const allowlist = [{ runtime: "codex", capability: "testing" }];

  it("downgrades only the exact configured runtime+capability pair", () => {
    expect(requiresHumanApproval("write", { runtimeKind: "codex", capabilities: ["testing"], allowlist })).toBe(false);
    expect(requiresHumanApproval("write", { runtimeKind: "claude-code", capabilities: ["testing"], allowlist })).toBe(true);
    expect(requiresHumanApproval("write", { runtimeKind: "codex", capabilities: ["backend"], allowlist })).toBe(true);
    expect(requiresHumanApproval("write", { runtimeKind: "codex", capabilities: ["testing", "backend"], allowlist })).toBe(true);
    expect(requiresHumanApproval("write", { runtimeKind: "codex", capabilities: [], allowlist })).toBe(true);
    expect(requiresHumanApproval("write", { runtimeKind: null, capabilities: ["testing"], allowlist })).toBe(true);
  });

  it("never downgrades deploy or external, and is empty by default", () => {
    const deployList = [{ runtime: "codex", capability: "devops" }];
    expect(requiresHumanApproval("deploy", { runtimeKind: "codex", capabilities: ["devops"], allowlist: deployList })).toBe(true);
    expect(requiresHumanApproval("external", { runtimeKind: "codex", capabilities: ["devops"], allowlist: deployList })).toBe(true);
    expect(requiresHumanApproval("write", { runtimeKind: "codex", capabilities: ["testing"] })).toBe(true);
  });

  it("reads the per-workspace allowlist from config, ignoring other workspaces and malformed input", () => {
    const raw = JSON.stringify({ "ws-a": [{ runtime: "codex", capability: "testing" }, { runtime: 1 }], "ws-b": "nope" });
    expect(workspaceApprovalAllowlist("ws-a", raw)).toEqual([{ runtime: "codex", capability: "testing" }]);
    expect(workspaceApprovalAllowlist("ws-b", raw)).toEqual([]);
    expect(workspaceApprovalAllowlist("ws-c", raw)).toEqual([]);
    expect(workspaceApprovalAllowlist("ws-a", "{not json")).toEqual([]);
    expect(workspaceApprovalAllowlist("ws-a", undefined)).toEqual([]);
    expect(workspaceApprovalAllowlist(null, raw)).toEqual([]);
  });
});
