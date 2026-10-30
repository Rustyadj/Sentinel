// The workspace runner: the only Sentinel process that holds the host Docker
// socket (docs/SECURITY_REMEDIATION.md §3). The internet-facing app reaches
// workspaces through it with HMAC-signed requests (src/lib/agent-workspaces/runner).
// It listens on the internal compose network only and publishes no port.
import { createServer, type IncomingMessage } from "node:http";
import { db } from "@/lib/db";
import { DockerWorkspaceProvider } from "@/lib/agent-workspaces/providers/docker";
import { containerLogsLocally, inspectContainersLocally } from "@/lib/agent-workspaces/runner/containers";
import { RUNNER_MAX_BODY_BYTES, runnerSecret } from "@/lib/agent-workspaces/runner/protocol";
import { createRunnerHandler } from "@/lib/agent-workspaces/runner/server";
import { startWorkerHeartbeat } from "./heartbeat";

const PORT = Number(process.env.WORKSPACE_RUNNER_PORT ?? "8790");
const provider = new DockerWorkspaceProvider();
const handle = createRunnerHandler({
  secret: runnerSecret(), // throws at startup when missing or short: fail closed
  provider,
  inspect: inspectContainersLocally,
  logs: containerLogsLocally,
});

async function readBody(message: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of message) {
    size += (chunk as Buffer).length;
    if (size > RUNNER_MAX_BODY_BYTES) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

const server = createServer(async (message, reply) => {
  try {
    const hasBody = message.method !== "GET" && message.method !== "HEAD";
    const request = new Request(`http://runner${message.url ?? "/"}`, {
      method: message.method,
      headers: message.headers as Record<string, string>,
      body: hasBody ? new Uint8Array(await readBody(message)) : undefined,
    });
    const response = await handle(request);
    reply.writeHead(response.status, { "content-type": "application/json" });
    reply.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    reply.writeHead(400, { "content-type": "application/json" });
    reply.end(JSON.stringify({ error: { message: "Bad request.", code: "invalid_body" } }));
  }
});
// Long operations (snapshots, image pulls, 30-minute commands) must not be cut off by the server.
server.requestTimeout = 0;
server.listen(PORT, () => console.log(`[workspace-runner] listening on :${PORT}`));

const stopHeartbeat = startWorkerHeartbeat("workspace-runner", async () => {
  await db.$queryRaw`SELECT 1`.catch(() => { throw new Error("database unreachable"); });
  const docker = await provider.isAvailable();
  if (!docker.available) throw new Error(`docker unavailable: ${docker.reason ?? "unknown"}`);
});

async function shutdown() {
  stopHeartbeat();
  server.close();
  await db.$disconnect();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
