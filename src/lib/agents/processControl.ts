import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ALLOWED_AGENT_IDS, getVpsAgent } from "./registry";

const execFileAsync = promisify(execFile);

function assertAgentId(agentId: string) {
  if (!ALLOWED_AGENT_IDS.has(agentId)) throw new Error("Agent is not allowlisted");
}

function containerName(agentId: string) {
  assertAgentId(agentId);
  const name = getVpsAgent(agentId)?.containerName;
  if (!name) throw new Error("Agent does not use a Docker runtime");
  return name;
}

export async function getContainerLogs(agentId: string, lines: number) {
  return execFileAsync("docker", ["logs", "--tail", String(Math.min(Math.max(lines, 1), 500)), containerName(agentId)], {
    timeout: 8_000,
    windowsHide: true,
  });
}

export async function restartContainer(agentId: string) {
  return execFileAsync("docker", ["restart", containerName(agentId)], { timeout: 30_000, windowsHide: true });
}

export async function reloadContainer(agentId: string) {
  return execFileAsync("docker", ["kill", "--signal=SIGHUP", containerName(agentId)], { timeout: 10_000, windowsHide: true });
}
