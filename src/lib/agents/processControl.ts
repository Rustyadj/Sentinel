import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ALLOWED_AGENT_IDS } from "./registry";

const execFileAsync = promisify(execFile);

function assertAgentId(agentId: string) {
  if (!ALLOWED_AGENT_IDS.has(agentId)) throw new Error("Agent is not allowlisted");
}

export async function getContainerLogs(agentId: string, lines: number) {
  assertAgentId(agentId);
  return execFileAsync("docker", ["logs", "--tail", String(Math.min(Math.max(lines, 1), 500)), agentId], {
    timeout: 8_000,
    windowsHide: true,
  });
}

export async function restartContainer(agentId: string) {
  assertAgentId(agentId);
  return execFileAsync("docker", ["restart", agentId], { timeout: 30_000, windowsHide: true });
}

export async function reloadContainer(agentId: string) {
  assertAgentId(agentId);
  return execFileAsync("docker", ["kill", "--signal=SIGHUP", agentId], { timeout: 10_000, windowsHide: true });
}
