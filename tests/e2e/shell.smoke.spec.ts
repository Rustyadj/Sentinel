import { expect, test } from "@playwright/test";

const routes = [
  ["Mission Control", "/"],
  ["Chat", "/chat"],
  ["Organization", "/workspaces/organization"],
  ["Agents", "/agents"],
  ["Learning Core", "/learning"],
  ["Bots", "/bots"],
  ["Settings", "/settings"],
  ["Task detail", "/tasks/not-a-real-task"],
] as const;

for (const [name, route] of routes) {
  test(`${name} has a recoverable shell`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error: a client-side exception");
  });
}

// Unauthenticated, none of the new surfaces may leak data: pages land on sign-in, APIs answer 401/404, never 500.
for (const path of ["/api/bots", "/api/graph/scoped", "/api/orrery/activity", "/api/memories", "/api/approvals/x"]) {
  test(`${path} refuses an anonymous caller without erroring`, async ({ request }) => {
    const response = await request.fetch(path, { method: path.startsWith("/api/approvals") ? "PATCH" : "GET", data: path.startsWith("/api/approvals") ? { status: "approved" } : undefined, maxRedirects: 0 });
    expect(response.status(), path).toBeLessThan(500);
    expect([307, 308, 400, 401, 403, 404]).toContain(response.status());
  });
}
