import http from "node:http";
import type { AddressInfo, LookupFunction } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// These tests drive real sockets, but a local TLS server would need a trusted
// certificate. Swapping node:https for node:http keeps everything the wrapper
// does — lookup on the connection, redirect handling, header stripping — while
// letting a plain local server answer.
vi.mock("node:https", async () => {
  const plain = await vi.importActual<typeof import("node:http")>("node:http");
  const request = (url: URL, options: http.RequestOptions, callback: (res: http.IncomingMessage) => void) => {
    const plainUrl = new URL(url);
    plainUrl.protocol = "http:";
    return plain.request(plainUrl, options, callback);
  };
  return { ...plain, default: { ...plain, request }, request };
});

import { createPublicOnlyFetch, publicOnlyFetch } from "@/lib/net/public-fetch";
import { publicOnlyLookup } from "@/lib/net/public-address";

let server: http.Server; let port: number;
const seen: Array<{ host?: string; authorization?: string; method?: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    seen.push({ host: req.headers.host, authorization: req.headers.authorization, method: req.method });
    const target = new URL(req.url ?? "/", "https://placeholder").searchParams.get("to");
    if (target) { res.writeHead(302, { location: target.replace("PORT", String(port)) }).end(); return; }
    res.writeHead(200, { "content-type": "text/plain" }).end(`ok ${req.method}`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => { await new Promise((resolve) => server.close(resolve)); });

/**
 * Pretends `origin.test` and `other.test` are public hosts that happen to live
 * on this machine; every other name goes through the real `publicOnlyLookup`.
 */
const testLookup: LookupFunction = (hostname, options, callback) => {
  if (hostname === "origin.test" || hostname === "other.test") {
    if (options.all) (callback as (e: null, a: Array<{ address: string; family: number }>) => void)(null, [{ address: "127.0.0.1", family: 4 }]);
    else callback(null, "127.0.0.1", 4);
    return;
  }
  publicOnlyLookup(hostname, options, callback);
};
const fetchViaTestHosts = createPublicOnlyFetch({ lookup: testLookup });

describe("publicOnlyFetch", () => {
  it("refuses a hostname that resolves to loopback when the socket connects", async () => {
    await expect(publicOnlyFetch(`https://localhost:${port}/`)).rejects.toThrow(/fetch failed/);
    expect(seen).toHaveLength(0);
  });

  it("refuses non-public IP literals and non-https schemes before connecting", async () => {
    for (const url of ["https://127.0.0.1/", "https://[::1]/", "https://[::ffff:7f00:1]/", "https://169.254.169.254/latest", "https://[64:ff9b::a9fe:a9fe]/"]) {
      await expect(publicOnlyFetch(url)).rejects.toThrow(/not a public address/);
    }
    await expect(publicOnlyFetch("http://example.com/")).rejects.toThrow(/only https/);
    await expect(publicOnlyFetch("https://user:pw@example.com/")).rejects.toThrow(/credentials/);
  });

  it("serves a response from an allowed host", async () => {
    const response = await fetchViaTestHosts(`https://origin.test:${port}/hello`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok GET");
  });

  it("does not follow a redirect to a private address, by name or by literal", async () => {
    const start = seen.length;
    await expect(fetchViaTestHosts(`https://origin.test:${port}/?to=${encodeURIComponent("https://localhost:PORT/secret")}`)).rejects.toThrow(/fetch failed/);
    await expect(fetchViaTestHosts(`https://origin.test:${port}/?to=${encodeURIComponent("https://169.254.169.254/latest/meta-data")}`)).rejects.toThrow(/not a public address/);
    await expect(fetchViaTestHosts(`https://origin.test:${port}/?to=${encodeURIComponent("http://other.test:PORT/")}`)).rejects.toThrow(/only https/);
    // Only the two redirecting requests reached a server; no redirect target did.
    expect(seen.slice(start).map((entry) => entry.host)).toEqual([`origin.test:${port}`, `origin.test:${port}`, `origin.test:${port}`]);
  });

  it("follows a redirect to another public host, dropping credentials and turning POST into GET", async () => {
    const start = seen.length;
    const response = await fetchViaTestHosts(`https://origin.test:${port}/?to=${encodeURIComponent("https://other.test:PORT/next")}`, {
      method: "POST", body: "{}", headers: { authorization: "Bearer secret", "content-type": "application/json" },
    });
    expect(await response.text()).toBe("ok GET");
    expect(response.url).toBe(`https://other.test:${port}/next`);
    expect(seen.slice(start)).toEqual([
      { host: `origin.test:${port}`, authorization: "Bearer secret", method: "POST" },
      { host: `other.test:${port}`, authorization: undefined, method: "GET" },
    ]);
  });

  it("returns the redirect itself when asked not to follow", async () => {
    const response = await fetchViaTestHosts(`https://origin.test:${port}/?to=${encodeURIComponent("https://localhost/")}`, { redirect: "manual" });
    expect(response.status).toBe(302);
    await expect(fetchViaTestHosts(`https://origin.test:${port}/?to=${encodeURIComponent("https://other.test:PORT/")}`, { redirect: "error" })).rejects.toThrow(/redirect/);
  });

  it("honours an abort signal", async () => {
    await expect(fetchViaTestHosts(`https://origin.test:${port}/`, { signal: AbortSignal.abort(new Error("stop")) })).rejects.toThrow(/stop/);
  });
});
