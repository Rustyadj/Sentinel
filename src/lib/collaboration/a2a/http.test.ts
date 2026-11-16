// @vitest-environment node
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { OutsideAgentError, requestOutsideJson } from "./http";

// A real socket, because what is being tested is what this module does with
// one: refuse the address, refuse a redirect, stop reading at the cap.

let server: Server;
let base: string;
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? "");
    if (req.url === "/redirect") { res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); return res.end(); }
    if (req.url === "/forbidden") { res.writeHead(401); return res.end(); }
    if (req.url === "/broken") { res.writeHead(500); return res.end("nope"); }
    if (req.url === "/html") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>"); }
    if (req.url === "/huge") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ blob: "x".repeat(50_000) })); }
    if (req.url === "/slow") return; // never answers
    if (req.url === "/drip") { // answers forever, a little at a time
      res.writeHead(200, { "content-type": "application/json" });
      const drip = setInterval(() => res.write(" "), 20);
      res.on("close", () => clearInterval(drip));
      return;
    }
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization ?? null, body: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.closeAllConnections(); server.close(); });
afterEach(() => { delete process.env.PROJECT_AGENT_ALLOW_PRIVATE; hits.length = 0; });

const failure = async (path: string, options: Partial<{ timeoutMs: number; maxBytes: number }> = {}) => {
  const error = await requestOutsideJson({ url: `${base}${path}`, method: "GET", timeoutMs: 2_000, maxBytes: 10_000, ...options }).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(OutsideAgentError);
  return (error as OutsideAgentError).code;
};

describe("requestOutsideJson", () => {
  it("never connects to a local address unless private agents are explicitly allowed", async () => {
    expect(await failure("/ok")).toBe("url_invalid"); // plain http
    expect(hits).toEqual([]);
  });

  describe("with private agents allowed (development only)", () => {
    const allow = () => { process.env.PROJECT_AGENT_ALLOW_PRIVATE = "1"; };

    it("sends the body and headers and returns the parsed answer", async () => {
      allow();
      const answer = await requestOutsideJson({ url: `${base}/ok`, method: "POST", headers: { authorization: "Bearer t" }, body: { a: 1 }, timeoutMs: 2_000, maxBytes: 10_000 });
      expect(answer).toEqual({ method: "POST", auth: "Bearer t", body: { a: 1 } });
    });

    it("refuses a redirect rather than following it", async () => { allow(); expect(await failure("/redirect")).toBe("bad_status"); });
    it("reports a refused token", async () => { allow(); expect(await failure("/forbidden")).toBe("unauthorized"); });
    it("reports a server error", async () => { allow(); expect(await failure("/broken")).toBe("bad_status"); });
    it("reports a non-JSON answer", async () => { allow(); expect(await failure("/html")).toBe("bad_response"); });
    it("stops reading past the size cap", async () => { allow(); expect(await failure("/huge", { maxBytes: 1_000 })).toBe("too_large"); });
    it("gives up on a server that does not answer", async () => { allow(); expect(await failure("/slow", { timeoutMs: 100 })).toBe("timed_out"); });
    it("gives up at the deadline on a server that keeps trickling data", async () => {
      allow();
      const started = Date.now();
      expect(await failure("/drip", { timeoutMs: 100 })).toBe("timed_out");
      expect(Date.now() - started).toBeLessThan(1_000);
    });
  });
});
