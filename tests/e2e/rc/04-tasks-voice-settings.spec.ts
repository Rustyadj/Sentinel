// Task detail (PR #41), permissions, and the intended voice behaviour, in a real browser.
import { expect, test } from "@playwright/test";
import { api, seed, signedIn } from "./support";

test.describe.configure({ mode: "serial" });

let taskId = "";

test("owner opens the live Task detail view for a workspace task", async ({ browser }) => {
  const { page, context } = await signedIn(browser, "owner");
  const created = await api<{ id: string }>(page, "POST", "/api/tasks", { title: "RC pour the north wall", description: "Detail view probe", workspaceId: seed().workspaces.alpha, priority: "high", status: "backlog" });
  expect(created.status).toBe(201);
  taskId = created.body.id;

  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByRole("heading", { name: "RC pour the north wall" })).toBeVisible();
  // One app shell, not two: tasks/layout.tsx already provides it, and PR #41's own [id]/layout.tsx used to nest a second.
  await expect(page.getByText(/Search nodes, concepts/)).toHaveCount(1);
  await expect(page.getByText("Control plane")).toHaveCount(1);
  await expect(page.getByText("Ownership")).toBeVisible();
  await expect(page.getByText("Repository")).toBeVisible();
  await expect(page.getByText("No orchestration events recorded for this task yet.")).toBeVisible();
  await page.screenshot({ path: "test-results/rc-evidence/task-detail-owner.png" });
  await context.close();
});

test("a workspace member can read it; a user outside the workspace gets not-found, not a hint that it exists", async ({ browser }) => {
  const member = await signedIn(browser, "member");
  await member.page.goto(`/tasks/${taskId}`);
  await expect(member.page.getByRole("heading", { name: "RC pour the north wall" })).toBeVisible();
  await member.context.close();

  const outsider = await signedIn(browser, "outsider");
  await outsider.page.goto(`/tasks/${taskId}`);
  await expect(outsider.page.getByText("RC pour the north wall")).toHaveCount(0);
  await expect(outsider.page.getByText("Detail view probe")).toHaveCount(0);
  await expect(outsider.page.getByRole("heading", { name: /not found|404/i }).first()).toBeVisible();
  const forbiddenView = await outsider.page.locator("main").first().innerText().catch(() => "");
  // Indistinguishable from a task that does not exist at all.
  await outsider.page.goto("/tasks/does-not-exist");
  const missingView = await outsider.page.locator("main").first().innerText().catch(() => "");
  expect(forbiddenView).toBe(missingView);
  // The same boundary on the task API.
  expect((await api(outsider.page, "GET", `/api/tasks?workspaceId=${seed().workspaces.alpha}`)).status).toBeGreaterThanOrEqual(403);
  await outsider.context.close();
});

test("the Task detail page does not ship approval payloads or other internals to the browser", async ({ browser }) => {
  const owner = await signedIn(browser, "owner");
  const html = await (await owner.page.request.get(`/tasks/${taskId}`)).text();
  expect(html).toContain("RC pour the north wall");
  for (const secret of ["requesterUserId", "reviewerUserId", "idempotencyKey", "guardianDecisionId"]) expect(html).not.toContain(secret);
  await owner.context.close();
});

test("a memory made through the memory API shows up in the graph with its owner's access only", async ({ browser }) => {
  const owner = await signedIn(browser, "owner");
  const outsider = await signedIn(browser, "outsider");
  const memory = await api<{ id: string }>(owner.page, "POST", "/api/memories", { type: "fact", scope: "user", source: "rc", content: "RC bridge probe: crews pour north walls in the morning." });
  expect(memory.status).toBe(201);
  const mine = await api<{ nodes: { id: string; title: string; type: string }[] }>(owner.page, "GET", "/api/graph/scoped?limit=400");
  const node = mine.body.nodes.find((n) => n.title.startsWith("RC bridge probe"));
  expect(node?.type).toBe("Memory");
  const theirs = await api<{ nodes: { title: string }[] }>(outsider.page, "GET", "/api/graph/scoped?limit=400");
  expect(theirs.body.nodes.some((n) => n.title.startsWith("RC bridge probe"))).toBe(false);
  expect((await api(outsider.page, "GET", `/api/graph/scoped?focus=${node!.id}&depth=1`)).status).toBe(404);
  expect((await api(owner.page, "DELETE", `/api/memories/${memory.body.id}`)).status).toBe(204);
  await owner.context.close(); await outsider.context.close();
});

test("voice: the default provider is OpenAI Realtime, and an unconfigured deployment says so instead of faking a transcript", async ({ browser }) => {
  const context = await browser.newContext({ permissions: ["microphone"] });   // the browser is launched with a fake microphone (see playwright.rc.config.ts)
  const page = await context.newPage();
  await page.goto("/auth/signin");
  await page.getByPlaceholder("Email").fill("owner@rc.test");
  await page.getByPlaceholder("Password").fill(seed().password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"));

  // Settings: nothing stored, so the control shows the default.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(page.getByLabel("Speech provider")).toHaveValue("openai_realtime");
  expect(await page.evaluate(() => window.localStorage.getItem("sentinel.voice.provider"))).toBeNull();

  // Starting a voice session reaches the realtime session endpoint (not browser STT, not a mock) …
  await page.goto("/chat");
  const session = page.waitForResponse((r) => r.url().includes("/api/voice/openai/session"), { timeout: 30_000 });
  await page.getByRole("button", { name: "Start voice input" }).first().click();
  const response = await session;
  expect(response.request().method()).toBe("POST");
  // … which, with no OpenAI key on this disposable stack, refuses clearly. The user is told; nothing pretends to transcribe.
  expect(response.status()).toBe(503);
  await expect(page.getByText("The live voice layer is not configured on this deployment")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "test-results/rc-evidence/voice-unconfigured.png" });

  // Choosing Browser Speech is explicit, persists, and stops the app using the realtime endpoint.
  await page.goto("/settings");
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await page.getByLabel("Speech provider").selectOption("browser_stt");
  expect(await page.evaluate(() => window.localStorage.getItem("sentinel.voice.provider"))).toBe("browser_stt");
  await page.reload();
  await page.getByRole("button", { name: "Voice", exact: true }).click();
  await expect(page.getByLabel("Speech provider")).toHaveValue("browser_stt");
  let realtimeCalls = 0;
  page.on("request", (request) => { if (request.url().includes("/api/voice/openai/session")) realtimeCalls += 1; });
  await page.goto("/chat");
  await page.getByRole("button", { name: "Start voice input" }).first().click();
  await page.waitForTimeout(2500);
  expect(realtimeCalls).toBe(0);
  await context.close();
});
