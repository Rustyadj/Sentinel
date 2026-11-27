import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import bcrypt from "bcryptjs";

const datasourceUrl = process.env.SENTINEL_WORKFORCE_E2E_DATABASE_URL;
test.skip(!datasourceUrl, "Requires an isolated, migrated workforce E2E database.");

test("organization ownership, Titan ICF draft and recorded operations", async ({ page, isMobile }) => {
  test.setTimeout(120_000);
  const dbUrl = new URL(datasourceUrl!);
  if (!["localhost", "127.0.0.1"].includes(dbUrl.hostname) || !/^\/sentinel_.*_e2e_test$/.test(dbUrl.pathname)) {
    throw new Error("Point this suite at a local, isolated Sentinel E2E database.");
  }
  const db = new PrismaClient({ datasourceUrl });
  const suffix = randomUUID();
  const email = `workforce-e2e-${suffix}@example.test`;
  const password = randomUUID();
  const owner = await db.user.create({
    data: { email, name: "Workforce operator", passwordHash: await bcrypt.hash(password, 4) },
  });
  const org = await db.organization.create({ data: { name: "Titan ICF", ownerId: owner.id } });
  const workspace = await db.workspace.create({
    data: { slug: `titan-e2e-${suffix}`, name: `Titan ICF E2E ${suffix}`, ownerId: owner.id, organizationId: org.id },
  });
  await db.objective.create({
    data: { workspaceId: workspace.id, userId: owner.id, title: "Research construction leads", goal: "Find leads", templateKey: "test_fixture" },
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto("/auth/signin?callbackUrl=%2Fworkforce");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(password);
    await page.locator("form").getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/workforce$/, { timeout: 35_000 });
    await expect(page).toHaveTitle(/Workforce · Sentinel OS/);
    await page.getByRole("combobox", { name: "Workspace", exact: true }).selectOption(workspace.id);
    await expect(page.getByRole("heading", { name: "Workspace overview" })).toBeVisible({ timeout: 35_000 });
    await expect(page.getByText("Application error")).toHaveCount(0);

    await page.getByRole("tab", { name: "Organization" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Marketing");
    await page.getByRole("button", { name: "Save department" }).click();
    await expect(page.getByRole("button", { name: "Edit Marketing" })).toBeVisible({ timeout: 25_000 });
    await page.getByRole("button", { name: "Edit Marketing" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Marketing and Growth");
    await page.getByRole("button", { name: "Save department" }).click();
    await expect(page.getByRole("button", { name: "Edit Marketing and Growth" })).toBeVisible();

    await page.getByRole("tab", { name: "Genesis" }).click();
    await page.getByRole("button", { name: "Marketing template" }).click();
    await expect(page.getByRole("group", { name: "Jordan" }).getByLabel("Cadence")).toHaveValue("weekly");
    await expect(page.getByRole("group", { name: "Morgan" }).getByLabel("Reports to")).toHaveValue("reporting");
    const exportEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export draft" }).click();
    expect((await exportEvent).suggestedFilename()).toBe("sentinel-workforce-plan.json");

    await page.getByRole("tab", { name: "Operations" }).click();
    await expect(page.getByText("Research construction leads", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expect(page.getByText("Paused by operator.", { exact: true })).toBeVisible({ timeout: 25_000 });
    expect((await db.objective.findFirstOrThrow({ where: { workspaceId: workspace.id } })).status).toBe("paused");
    const evidence = process.env.SENTINEL_WORKFORCE_E2E_SCREENSHOTS;
    if (evidence) {
      await mkdir(evidence, { recursive: true });
      await page.screenshot({ path: join(evidence, isMobile ? "mobile.png" : "desktop.png") });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("tab", { name: "Genesis" }).click();
      await expect(page.getByRole("heading", { name: "Department draft" })).toBeVisible();
      await page.screenshot({ path: join(evidence, "mobile-genesis.png") });
    }
    expect(pageErrors).toEqual([]);
  } finally {
    await db.$disconnect();
  }
});
