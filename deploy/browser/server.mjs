import { chromium } from "playwright-core";

async function start() {
  const server = process.env.SENTINEL_BROWSER_WORKFLOW_PROXY;
  const wsPath = process.env.SENTINEL_BROWSER_WS_PATH;
  if (!server || !wsPath || !/^\/[A-Za-z0-9_-]{32,}$/.test(wsPath)) {
    throw new Error("Browser service requires a proxy URL and a private WebSocket path.");
  }
  const proxy = new URL(server);
  if (!["http:", "https:"].includes(proxy.protocol) || proxy.username || proxy.password) {
    throw new Error("Browser service requires a deployment-managed HTTP proxy.");
  }
  const browser = await chromium.launchServer({
    host: "0.0.0.0",
    port: 9231,
    wsPath,
    headless: true,
    proxy: { server: proxy.href, bypass: "<-loopback>" },
    args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-quic"],
  });
  process.on("SIGTERM", () => void browser.close());
  process.on("SIGINT", () => void browser.close());
  browser.on("close", () => process.exit(0));
  console.log("Sentinel browser is ready.");
}

start().catch(() => {
  console.error("The Sentinel browser service could not start.");
  process.exit(1);
});
