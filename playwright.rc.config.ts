import { defineConfig, devices } from "@playwright/test";

// Release-candidate verification: a real browser against the isolated stack in deploy/verify
// (docker compose -f deploy/verify/docker-compose.yml up -d, then scripts/verify/seed-rc.ts).
// There is no webServer here on purpose — this suite never starts, and never targets, anything else.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3190";
if (!/^http:\/\/(127\.0\.0\.1|localhost):3190$/.test(baseURL)) {
  throw new Error(`The RC suite only runs against the isolated verification stack (127.0.0.1:3190), not ${baseURL}`);
}

export default defineConfig({
  testDir: "./tests/e2e/rc",
  // One shared database and one fake agent: the specs build on each other's state, in file order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "test-results/rc-report" }], ["json", { outputFile: "test-results/rc-results.json" }]],
  outputDir: "test-results/rc-artifacts",
  use: { baseURL, trace: "retain-on-failure", screenshot: "on", video: "off", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
  projects: [{ name: "chromium", use: { launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] } } }],
});
