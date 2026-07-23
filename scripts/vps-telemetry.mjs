import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import { promisify } from "node:util";

const execute = promisify(execFile);
const port = Number(process.env.SENTINEL_TELEMETRY_PORT ?? 9464);
const token = process.env.SENTINEL_TELEMETRY_TOKEN;

if (!token) throw new Error("SENTINEL_TELEMETRY_TOKEN is required");

function cpuSnapshot() {
  return os.cpus().reduce((total, cpu) => {
    const times = Object.values(cpu.times);
    return { idle: total.idle + cpu.times.idle, total: total.total + times.reduce((sum, value) => sum + value, 0) };
  }, { idle: 0, total: 0 });
}

async function cpuPercent() {
  const before = cpuSnapshot();
  await new Promise((resolve) => setTimeout(resolve, 250));
  const after = cpuSnapshot();
  const total = after.total - before.total;
  return total > 0 ? Number((100 * (1 - (after.idle - before.idle) / total)).toFixed(1)) : 0;
}

async function diskUsage() {
  try {
    const { stdout } = await execute("df", ["-Pk", "/"], { timeout: 2_000 });
    const columns = stdout.trim().split("\n").at(-1)?.trim().split(/\s+/) ?? [];
    return { diskTotalBytes: Number(columns[1]) * 1024, diskUsedBytes: Number(columns[2]) * 1024 };
  } catch {
    return {};
  }
}

async function networkTotals() {
  try {
    const text = await readFile("/proc/net/dev", "utf8");
    let received = 0;
    let transmitted = 0;
    for (const line of text.split("\n").slice(2)) {
      const [name, values] = line.split(":");
      if (!values || name.trim() === "lo") continue;
      const fields = values.trim().split(/\s+/).map(Number);
      received += fields[0] || 0;
      transmitted += fields[8] || 0;
    }
    return `${received} B received / ${transmitted} B transmitted`;
  } catch {
    return undefined;
  }
}

function dockerBytes(value) {
  const match = String(value ?? "").trim().match(/^([\d.]+)\s*([KMGT]?i?B)$/i);
  if (!match) return undefined;
  const scale = { B: 1, KB: 1e3, KIB: 1024, MB: 1e6, MIB: 1024 ** 2, GB: 1e9, GIB: 1024 ** 3, TB: 1e12, TIB: 1024 ** 4 };
  return Number(match[1]) * (scale[match[2].toUpperCase()] ?? 1);
}

async function containers() {
  try {
    const [{ stdout: stats }, { stdout: processes }] = await Promise.all([
      execute("docker", ["stats", "--no-stream", "--format", "{{json .}}"], { timeout: 5_000, maxBuffer: 1024 * 1024 }),
      execute("docker", ["ps", "--format", "{{json .}}"], { timeout: 5_000, maxBuffer: 1024 * 1024 }),
    ]);
    const states = new Map(processes.trim().split("\n").filter(Boolean).map((line) => { const item = JSON.parse(line); return [item.Names, item.State]; }));
    return stats.trim().split("\n").filter(Boolean).map((line) => {
      const item = JSON.parse(line);
      const [used] = String(item.MemUsage ?? "").split("/");
      return {
        name: item.Name,
        status: states.get(item.Name) ?? "unknown",
        cpuPercent: Number.parseFloat(item.CPUPerc) || 0,
        memoryUsedBytes: dockerBytes(used),
        network: item.NetIO,
      };
    });
  } catch {
    return undefined;
  }
}

async function readiness() {
  const url = process.env.SENTINEL_READY_URL ?? "http://127.0.0.1:3000/api/ready";
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000), headers: { Accept: "application/json" } });
    const body = await response.json();
    return {
      postgres: body?.checks?.database,
      redis: body?.checks?.redis,
    };
  } catch {
    return {};
  }
}

async function agentTelemetry() {
  let targets = [];
  try { targets = JSON.parse(process.env.SENTINEL_AGENT_TELEMETRY ?? "[]"); } catch { return []; }
  const settled = await Promise.allSettled(targets.map(async (target) => {
    const response = await fetch(target.url, {
      signal: AbortSignal.timeout(3_000),
      headers: { Accept: "application/json", ...(target.token ? { Authorization: `Bearer ${target.token}` } : {}) },
    });
    if (!response.ok) throw new Error(`Agent ${target.id} returned ${response.status}`);
    return { id: target.id, ...await response.json() };
  }));
  return settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
}

async function collect() {
  const [cpu, disk, network, containerData, ready, agents] = await Promise.all([
    cpuPercent(), diskUsage(), networkTotals(), containers(), readiness(), agentTelemetry(),
  ]);
  const totalMemory = os.totalmem();
  return {
    observedAt: new Date().toISOString(),
    releaseSha: process.env.SENTINEL_RELEASE_SHA ?? null,
    host: { cpuPercent: cpu, memoryUsedBytes: totalMemory - os.freemem(), memoryTotalBytes: totalMemory, ...disk, network },
    containers: containerData,
    postgres: ready.postgres,
    redis: ready.redis,
    agents,
  };
}

createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json");
  if (request.url !== "/metrics" || request.method !== "GET") {
    response.writeHead(404).end(JSON.stringify({ error: "Not found" }));
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }
  try {
    response.writeHead(200).end(JSON.stringify(await collect()));
  } catch {
    response.writeHead(503).end(JSON.stringify({ error: "Telemetry collection failed" }));
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Sentinel telemetry listening on port ${port}`);
});
