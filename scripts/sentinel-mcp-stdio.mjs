#!/usr/bin/env node
import readline from "node:readline";

const endpoint = process.env.SENTINEL_MCP_URL ?? "http://127.0.0.1:3000/mcp";
const credential = process.env.SENTINEL_MCP_CREDENTIAL;
if (!credential) {
  process.stderr.write("SENTINEL_MCP_CREDENTIAL is required.\n");
  process.exit(1);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  try {
    const request = JSON.parse(line);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
        accept: "application/json",
        ...(request?.method === "tools/call" ? { "idempotency-key": request?.params?._meta?.idempotencyKey ?? crypto.randomUUID() } : {}),
      },
      body: JSON.stringify(request),
    });
    process.stdout.write(`${await response.text()}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } })}\n`);
  }
}
