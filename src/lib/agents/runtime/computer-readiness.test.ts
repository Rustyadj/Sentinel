import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeSessionStore } from "./store";
const mocks = vi.hoisted(() => ({ run: vi.fn(), hostRun: vi.fn(), list: vi.fn() }));
vi.mock("./workspace-runner", () => ({
  isPersonalComputer: () => true,
  codingCredential: () => ({ CODEX_API_KEY: "fixture-only" }),
  personalComputerRunner: async () => ({ workspace: { id: "codex-computer" }, executable: "codex", root: "/workspace/projects", runner: { run: mocks.run } }),
}));
import { CodexRuntimeAdapter } from "./codex";
const runtime = { id: "runtime-codex", agentId: "codex", kind: "codex" as const, transport: "process" as const, executable: "/host/must-never-run" };
describe("Codex computer readiness", () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.list.mockResolvedValue([]); });
  const adapter = () => new CodexRuntimeAdapter(async () => runtime, { list: mocks.list } as unknown as RuntimeSessionStore);
  it("reports installed but unready when the real command sandbox cannot start", async () => {
    mocks.run.mockResolvedValueOnce({ exitCode: 0, stdout: "codex-cli 0.153.4", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 1, stdout: "", stderr: "bwrap: No permissions to create a new namespace" });
    expect(await adapter().health(runtime)).toMatchObject({ installed: true, reachable: true, ready: false, failureCode: "sandbox_unavailable" });
    expect(mocks.run).toHaveBeenLastCalledWith("codex", expect.arrayContaining(["sandbox", "sh"]), expect.objectContaining({ cwd: "/workspace/projects", probe: true }));
  });
  it("requires a successful sandboxed command before reporting execution readiness", async () => {
    mocks.run.mockResolvedValueOnce({ exitCode: 0, stdout: "codex-cli 0.153.4", stderr: "" })
      .mockResolvedValueOnce({ exitCode: 0, stdout: "sentinel-sandbox-ready", stderr: "" });
    expect(await adapter().health(runtime)).toMatchObject({ ready: true, authenticated: null });
  });
});
