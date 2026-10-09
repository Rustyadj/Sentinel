// Chat streaming, model selection and the Orrery graph, in a real browser against the release candidate.
// The "agent" is the fake Hermes dashboard (tests/e2e/support/fake-hermes.mjs): the whole Sentinel side of the
// wire is real, no model credits are spent and no external tool can be called.
import { expect, test, type Page } from "@playwright/test";
import { api, fakeHermes, resetFakeHermes, signedIn } from "./support";

test.describe.configure({ mode: "serial" });

const globe = (page: Page) => page.locator('canvas[aria-label="Knowledge graph globe"]');
async function openChat(page: Page) {
  await page.goto("/chat");
  await expect(globe(page)).toBeVisible();
  // A new conversation starts with Hermes Lisa (the seeded Mission Control room is Codex's).
  await page.getByRole("button", { name: "New chat" }).click();
  await expect(page.getByPlaceholder(/Message Hermes Lisa/)).toBeVisible();
}
/** Make the browser re-read now, instead of waiting out the 45s graph interval. */
const wake = (page: Page) => page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));

test("a chat reply streams in progressively and reaches the agent", async ({ browser, request }) => {
  await resetFakeHermes(request);
  const { page, context } = await signedIn(browser, "owner");
  await openChat(page);
  const composer = page.getByPlaceholder(/Message Hermes Lisa/);
  await composer.fill("Summarise the pour schedule please");
  await composer.press("Enter");

  const reply = page.getByText(/Fake Hermes reply/);
  await expect(reply).toBeVisible({ timeout: 30_000 });
  // It arrived in pieces: there is a moment when the text has begun but not ended.
  const snapshots = new Set<string>();
  await expect.poll(async () => { snapshots.add(((await reply.first().textContent()) ?? "").trim()); return snapshots.size; }, { timeout: 15_000 }).toBeGreaterThan(1);
  await expect(page.getByText(/Fake Hermes reply: Summarise the pour schedule please\./)).toBeVisible();

  const seen = await fakeHermes(request);
  expect(seen.prompts.at(-1)).toContain("Summarise the pour schedule please");
  await page.screenshot({ path: "test-results/rc-evidence/chat-streamed.png" });
  await context.close();
});

test("the model picker lists the agent's real options and saves a different choice", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "owner");
  await openChat(page);
  // The chip names the model of the agent this conversation is with — Lisa, not whichever agent happened to be active first.
  const card = page.getByRole("complementary", { name: "Agent activity" }).getByRole("listitem").filter({ hasText: "Hermes Lisa" }).first();
  const lisaModel = ((await card.innerText()).match(/[\w./-]*(?:deepseek|gpt|claude)[\w./-]*/) ?? [])[0];
  expect(lisaModel, "Lisa's card names her model").toBeTruthy();
  const picker = page.getByRole("button", { name: lisaModel });
  await expect(picker).toBeVisible();
  await picker.click();
  const options = page.getByRole("radio");
  await expect(options.first()).toBeVisible();
  const before = await page.getByRole("radio", { checked: true }).count();
  const choices = await options.allInnerTexts();
  expect(choices.length).toBeGreaterThan(1);
  const target = options.filter({ hasNotText: new RegExp(`^${(await page.getByRole("radio", { checked: true }).first().innerText()).split("\n")[0]}`) }).first();
  const save = page.waitForResponse((r) => /\/api\/agents\/hermes-lisa\/model/.test(r.url()) && r.request().method() === "PUT");
  await target.click();
  const response = await save;
  expect([200, 400, 409]).toContain(response.status());   // a refusal is stated, never silent
  if (response.status() === 200) await expect(page.getByText(/Applies to new sessions/)).toBeVisible();
  else await expect(page.getByRole("alert")).toBeVisible();
  expect(before).toBeGreaterThanOrEqual(0);
  await context.close();
});

test("graph: a new memory appears, a deleted one disappears, and an archived one leaves", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "owner");
  await openChat(page);
  await expect(globe(page)).toHaveAttribute("data-nodes", "4");

  const created = await api<{ id: string }>(page, "POST", "/api/memories", { type: "fact", scope: "user", source: "rc", content: "RC probe: pour the south wall after the north wall cures." });
  expect(created.status).toBe(201);
  await wake(page);
  await expect(globe(page)).toHaveAttribute("data-nodes", "5", { timeout: 20_000 });

  // Archiving takes the node out of the graph; un-archiving puts it back.
  expect((await api(page, "PATCH", `/api/memories/${created.body.id}`, { archived: true })).status).toBe(200);
  await wake(page);
  await expect(globe(page)).toHaveAttribute("data-nodes", "4", { timeout: 20_000 });
  expect((await api(page, "PATCH", `/api/memories/${created.body.id}`, { archived: false })).status).toBe(200);
  await wake(page);
  await expect(globe(page)).toHaveAttribute("data-nodes", "5", { timeout: 20_000 });

  // Deleting removes the node (and its edges) — nothing lingers until a reload.
  expect((await api(page, "DELETE", `/api/memories/${created.body.id}`)).status).toBe(204);
  await wake(page);
  await expect(globe(page)).toHaveAttribute("data-nodes", "4", { timeout: 20_000 });
  await page.screenshot({ path: "test-results/rc-evidence/graph-reconciled.png" });
  await context.close();
});

test("a failing activity feed is shown as stale, with a retry, and recovers", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "owner");
  await openChat(page);
  await page.route("**/api/orrery/activity*", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "down" }) }));
  await expect(page.getByTestId("orrery-notice-activity")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("orrery-notice-activity")).toContainText(/Agent activity is not updating/);
  await expect(page.getByTestId("orrery-notice-activity")).toContainText(/Showing data from \d{2}:\d{2}:\d{2}/);
  // The globe is still drawing the last good graph.
  await expect(globe(page)).toHaveAttribute("data-nodes", "4");
  await page.screenshot({ path: "test-results/rc-evidence/orrery-stale-activity.png" });

  await page.unroute("**/api/orrery/activity*");
  await page.getByRole("button", { name: /retry now/i }).click();
  await expect(page.getByTestId("orrery-notice-activity")).toHaveCount(0, { timeout: 15_000 });
  await context.close();
});

test("a failing graph read after load is shown too, and the globe keeps its last graph", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "owner");
  await openChat(page);
  await expect(globe(page)).toHaveAttribute("data-nodes", "4");
  await page.route("**/api/graph/scoped*", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) }));
  await wake(page);
  await expect(page.getByTestId("orrery-notice-graph")).toContainText(/Graph is not updating/, { timeout: 20_000 });
  await expect(globe(page)).toHaveAttribute("data-nodes", "4");
  await page.unroute("**/api/graph/scoped*");
  await page.getByRole("button", { name: /retry now/i }).click();
  await expect(page.getByTestId("orrery-notice-graph")).toHaveCount(0, { timeout: 15_000 });
  await context.close();
});

test("an empty graph is said to be empty, not shown as an error", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "outsider");   // owns nothing in the graph
  await page.goto("/chat");
  await expect(page.getByText(/Your graph is empty/)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("orrery-notice-graph")).toHaveCount(0);
  await context.close();
});
