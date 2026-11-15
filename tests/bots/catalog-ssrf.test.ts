import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// `rebind.test` models a DNS-rebinding name: the registration check's lookup
// (node:dns/promises) is answered with a public address, the connection's
// lookup (node:dns, used by publicOnlyLookup) with loopback.
const REBIND_HOST = "rebind.test";
vi.mock("node:dns/promises", async () => {
  const actual = await vi.importActual<typeof import("node:dns/promises")>("node:dns/promises");
  const lookup = ((hostname: string, options?: unknown) =>
    hostname === REBIND_HOST ? Promise.resolve([{ address: "93.184.216.34", family: 4 }]) : (actual.lookup as (h: string, o?: unknown) => Promise<unknown>)(hostname, options)) as typeof actual.lookup;
  return { ...actual, default: { ...actual, lookup }, lookup };
});
vi.mock("node:dns", async () => {
  const actual = await vi.importActual<typeof import("node:dns")>("node:dns");
  const lookup = ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    if (hostname !== REBIND_HOST) return (actual.lookup as (...args: unknown[]) => void)(hostname, options, callback);
    if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
  }) as typeof actual.lookup;
  return { ...actual, default: { ...actual, lookup }, lookup };
});

import { assertSafeMcpUrl, discoverMcpTools } from "@/lib/bots/catalog";

afterEach(() => { delete process.env.MCP_CATALOG_ALLOW_PRIVATE; });

describe("assertSafeMcpUrl", () => {
  it.each([
    ["IPv4-mapped loopback in hex", "https://[::ffff:7f00:1]/mcp"],
    ["IPv4-mapped link-local / metadata", "https://[::ffff:169.254.169.254]/mcp"],
    ["IPv4-mapped 172.16/12", "https://[::ffff:172.16.0.1]/mcp"],
    ["NAT64", "https://[64:ff9b::a00:1]/mcp"],
    ["benchmarking 198.18/15", "https://198.18.0.1/mcp"],
    ["benchmarking 198.19", "https://198.19.255.254/mcp"],
    ["IPv4 multicast", "https://224.0.0.1/mcp"],
    ["IPv4 reserved", "https://240.0.0.1/mcp"],
    ["broadcast", "https://255.255.255.255/mcp"],
    ["IPv6 multicast", "https://[ff02::1]/mcp"],
    ["IPv6 unspecified", "https://[::]/mcp"],
    ["IPv6 loopback", "https://[::1]/mcp"],
    ["Docker bridge", "https://172.17.0.1/mcp"],
    ["cloud metadata", "https://169.254.169.254/latest"],
    ["carrier-grade NAT", "https://100.64.0.1/mcp"],
    ["this network", "https://0.0.0.0/mcp"],
    ["localhost by name", "https://localhost/mcp"],
  ])("refuses %s", async (_label, url) => {
    await expect(assertSafeMcpUrl(url)).rejects.toThrow(/private or loopback/);
  });

  it("accepts a public literal", async () => {
    await expect(assertSafeMcpUrl("https://93.184.216.34/mcp")).resolves.toBeInstanceOf(URL);
  });
});

describe("MCP discovery connections", () => {
  it("refuses a name that passed the check but resolves to loopback when connecting", async () => {
    await expect(assertSafeMcpUrl(`https://${REBIND_HOST}/mcp`)).resolves.toBeInstanceOf(URL);
    await expect(discoverMcpTools({ url: `https://${REBIND_HOST}/mcp`, authMode: "none" })).rejects.toThrow(/private or reserved address/);
  });

  describe("with MCP_CATALOG_ALLOW_PRIVATE=1", () => {
    let server: http.Server; let url: string;
    beforeAll(async () => {
      server = http.createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const mcp = new McpServer({ name: "local-provider", version: "1.0.0" });
        mcp.registerTool("ping", { description: "Ping" }, async () => ({ content: [{ type: "text", text: "pong" }] }));
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        await mcp.connect(transport);
        res.on("close", () => { void transport.close(); void mcp.close(); });
        await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
    });
    afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

    it("still discovers tools on a deliberately local server", async () => {
      process.env.MCP_CATALOG_ALLOW_PRIVATE = "1";
      const found = await discoverMcpTools({ url, authMode: "none" });
      expect(found.serverName).toBe("local-provider");
      expect(found.tools.map((tool) => tool.name)).toEqual(["ping"]);
    });

    it("refuses the same server without the opt-out", async () => {
      await expect(discoverMcpTools({ url, authMode: "none" })).rejects.toThrow(/https/);
      await expect(discoverMcpTools({ url: url.replace("http:", "https:"), authMode: "none" })).rejects.toThrow(/private or loopback/);
    });
  });
});
