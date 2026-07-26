import { expect, test } from "@playwright/test";

const routes = [
  ["Mission Control", "/"],
  ["Chat", "/chat"],
  ["Organization", "/workspaces/organization"],
  ["Agents", "/agents"],
  ["Knowledge Governance", "/memory"],
] as const;

for (const [name, route] of routes) {
  test(`${name} has a recoverable shell`, async ({ page }) => {
    const response = await page.goto(route);
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Application error: a client-side exception");
  });
}

test("Knowledge Governance remains usable at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/memory");
  expect(response?.status()).toBeLessThan(500);
  await expect(page.locator("body")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Application error: a client-side exception");
});
