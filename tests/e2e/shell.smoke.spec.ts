import { expect, test } from "@playwright/test";

const routes = [
  ["Mission Control", "/"],
  ["Chat", "/chat"],
  ["Organization", "/workspaces/organization"],
  ["Agents", "/agents"],
] as const;

for (const [name, route] of routes) {
  test(`${name} has a recoverable shell`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error: a client-side exception");
  });
}
