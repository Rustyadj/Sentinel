/**
 * Accept-header negotiation for the MCP endpoint.
 *
 * The Streamable HTTP transport answers 406 unless Accept names BOTH
 * application/json and text/event-stream. A client sending a wildcard Accept,
 * or no Accept at all, accepts those two types — refusing it is a false
 * negative that locks the client out of the server entirely. These tests pin
 * both the header rewrite and the end-to-end consequence through a real
 * transport, so a regression shows up as a 406 rather than as a connector
 * that mysteriously will not attach.
 */
import { describe, expect, it } from "vitest";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MCP_ACCEPT, withNegotiableAccept } from "@/lib/integrations/mcp-http";

function post(accept: string | null): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (accept !== null) headers.set("accept", accept);
  return new Request("https://sentinel.example/api/mcp", {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

/** Same construction as src/app/api/mcp/route.ts: stateless, JSON responses. */
async function roundTrip(request: Request) {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = new McpServer({ name: "sentinel-test", version: "1.0.0" });
  server.registerTool(
    "sentinel.probe",
    { title: "Probe", description: "probe", inputSchema: z.object({}) },
    async () => ({ structuredContent: {}, content: [{ type: "text" as const, text: "ok" }] }),
  );
  await server.connect(transport);
  const response = await transport.handleRequest(request);
  const body = await response.json();
  await server.close();
  return { status: response.status, body };
}

describe("withNegotiableAccept", () => {
  it("rewrites a wildcard Accept to the pair the transport requires", () => {
    expect(withNegotiableAccept(post("*/*")).headers.get("accept")).toBe(MCP_ACCEPT);
  });

  it("rewrites a wildcard carrying a q-value", () => {
    expect(withNegotiableAccept(post("*/*;q=0.8")).headers.get("accept")).toBe(MCP_ACCEPT);
  });

  it("rewrites an absent or empty Accept", () => {
    expect(withNegotiableAccept(post(null)).headers.get("accept")).toBe(MCP_ACCEPT);
    expect(withNegotiableAccept(post("   ")).headers.get("accept")).toBe(MCP_ACCEPT);
  });

  it("leaves a conforming Accept untouched", () => {
    const request = post(MCP_ACCEPT);
    expect(withNegotiableAccept(request)).toBe(request);
  });

  // A client that names concrete types has made a real claim about what it can
  // parse. Rewriting that would be putting words in its mouth, so it keeps its
  // header and still gets the transport's 406.
  it("does not rewrite a client that names concrete types", () => {
    const request = post("application/json");
    expect(withNegotiableAccept(request)).toBe(request);
    expect(request.headers.get("accept")).toBe("application/json");
  });

  it("preserves method, url and body while rewriting", async () => {
    const rewritten = withNegotiableAccept(post("*/*"));
    expect(rewritten.method).toBe("POST");
    expect(rewritten.url).toBe("https://sentinel.example/api/mcp");
    expect(await rewritten.json()).toMatchObject({ method: "tools/list" });
  });
});

describe("MCP endpoint accept negotiation, end to end", () => {
  it("406s a wildcard Accept when it is passed through unmodified", async () => {
    const { status } = await roundTrip(post("*/*"));
    expect(status).toBe(406);
  });

  it("lists tools for a wildcard Accept once negotiated", async () => {
    const { status, body } = await roundTrip(withNegotiableAccept(post("*/*")));
    expect(status).toBe(200);
    expect(body.result.tools.map((tool: { name: string }) => tool.name)).toContain("sentinel.probe");
  });

  it("lists tools when the client sent no Accept at all", async () => {
    const { status, body } = await roundTrip(withNegotiableAccept(post(null)));
    expect(status).toBe(200);
    expect(body.result.tools).toHaveLength(1);
  });
});
