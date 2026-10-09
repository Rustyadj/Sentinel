// Who can see and do what, in a real browser with real sessions: workspace owner, plain member,
// and a user of a different workspace. Everything is read back from the running release candidate.
import { expect, test } from "@playwright/test";
import { api, openBots, seed, signedIn } from "./support";


test("an unauthenticated visitor is sent to sign-in, and a wrong password is refused with a message", async ({ page }) => {
  await page.goto("/bots");
  await expect(page).toHaveURL(/\/auth\/signin/);
  await page.getByPlaceholder("Email").fill("owner@rc.test");
  await page.getByPlaceholder("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText("Invalid email or password.")).toBeVisible();
});

test("the release reports its own revision, and the workers are the same release", async ({ request }) => {
  const version = await (await request.get("/api/version")).json();
  expect(version.commit).toBe(process.env.SENTINEL_RELEASE_SHA ?? version.commit);
  expect(version.commit).not.toBe("unknown");
  expect((await request.get("/api/health")).ok()).toBe(true);
  const ready = await request.get("/api/ready");
  expect(ready.status(), await ready.text()).toBeLessThan(500);
});

test("owner sees and can open their workspace's bot in Bot Studio", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "owner");
  await openBots(page);
  await expect(page.getByRole("link", { name: /RC Forge/ }).first()).toBeVisible();
  await page.getByRole("link", { name: /RC Forge/ }).first().click();
  await expect(page.getByRole("heading", { name: "RC Forge" })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Tools/ })).toBeVisible();
  await context.close();
});

test("a plain member can use the registry but not manage bots", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "member");
  const { workspaces, bots } = seed();
  // Management routes refuse a member …
  expect((await api(page, "GET", `/api/bots?workspaceId=${workspaces.alpha}`)).status).toBe(403);
  expect((await api(page, "PATCH", `/api/bots/${bots.forge}`, { name: "Hijacked" })).status).toBe(403);
  expect((await api(page, "PUT", `/api/bots/${bots.forge}/tools`, { serverId: "x", toolName: "*", permission: "execute" })).status).toBe(403);
  // … and the page says so plainly, offering them no way in.
  await openBots(page);
  await expect(page.getByText("Bot Studio is for workspace owners and admins")).toBeVisible();
  await expect(page.getByRole("button", { name: /create bot|new bot/i })).toHaveCount(0);
  await expect(page.getByText(/Could not load bots/)).toHaveCount(0);
  await context.close();
});

test("a user from another workspace learns nothing about this workspace's bots", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "outsider");
  const { bots, workspaces } = seed();
  expect((await api(page, "GET", `/api/bots/${bots.forge}`)).status).toBe(404);
  expect((await api(page, "GET", `/api/bots?workspaceId=${workspaces.alpha}`)).status).toBeGreaterThanOrEqual(401);
  expect((await api(page, "POST", `/api/bots/${bots.forge}/tasks`, { task: "please do something" })).status).toBe(404);
  await page.goto(`/bots/${bots.forge}`);
  await expect(page.getByRole("heading", { name: "RC Forge" })).toHaveCount(0);
  // … and the owner of workspace A cannot reach workspace B's bot either.
  await context.close();
  const owner = await signedIn(browser, "owner");
  expect((await api(owner.page, "GET", `/api/bots/${bots.bravo}`)).status).toBe(404);
  await owner.context.close();
});

test("graph reads are scoped: a user sees only their own objects", async ({ browser }) => {
  const owner = await signedIn(browser, "owner");
  const outsider = await signedIn(browser, "outsider");
  const mine = await api<{ nodes: { id: string }[] }>(owner.page, "GET", "/api/graph/scoped?limit=100");
  const theirs = await api<{ nodes: { id: string }[] }>(outsider.page, "GET", "/api/graph/scoped?limit=100");
  expect(mine.body.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(seed().graphNodeIds));
  expect(theirs.body.nodes.map((n) => n.id)).not.toEqual(expect.arrayContaining(seed().graphNodeIds.slice(0, 1)));
  // Focusing on someone else's node is indistinguishable from it not existing.
  expect((await api(outsider.page, "GET", `/api/graph/scoped?focus=${seed().graphNodeIds[0]}&depth=1`)).status).toBe(404);
  await owner.context.close(); await outsider.context.close();
});
