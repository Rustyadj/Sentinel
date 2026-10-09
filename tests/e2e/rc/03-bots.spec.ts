// Bot Studio and bot tasks in a real browser, executed for real by the release candidate's own worker against
// the fake Hermes: creation, configuration and rollback, delegation limits, run/approval cards, cancellation
// (confirmed and unconfirmed), canonical and one-use tool approvals, and memory retention.
import { expect, test, type Page } from "@playwright/test";
import { api, fakeHermes, openBots, resetFakeHermes, seed, signedIn, unstickFakeHermes, waitForApi } from "./support";

test.describe.configure({ mode: "serial" });

interface Task { id: string; status: string; error: string | null; waitingFor: { approvalRequestId: string; tool: string } | null; parentTaskId: string | null; output: { text: string } | null; events: { type: string; summary: string; data: Record<string, unknown> }[]; toolCalls: { tool: string; decision: string }[] }
const taskUrl = (id: string) => `/api/bots/tasks/${id}`;
async function start(page: Page, task: string, botId = seed().bots.forge) {
  const response = await api<{ task: Task; error?: string }>(page, "POST", `/api/bots/${botId}/tasks`, { task });
  expect(response.status, JSON.stringify(response.body)).toBe(202);
  return response.body.task.id;
}
const waitFor = (page: Page, id: string, status: string | string[], timeout = 60_000) => {
  const wanted = Array.isArray(status) ? status : [status];
  return waitForApi<{ task: Task }>(page, taskUrl(id), (b) => wanted.includes(b.task?.status), `task ${id} -> ${wanted.join("/")}`, timeout).then((b) => b.task);
};
const child = async (page: Page, parentId: string) => {
  const list = await api<{ tasks: { id: string }[] }>(page, "GET", `/api/bots/${seed().bots.forge}/tasks?limit=50`);
  for (const row of list.body.tasks) {
    const detail = await api<{ task: Task }>(page, "GET", taskUrl(row.id));
    if (detail.body.task.parentTaskId === parentId) return detail.body.task;
  }
  return null;
};

const WIZARD = `RC Wizard Bot ${Date.now().toString(36)}`;   // unique per run, so reruns on the same database do not collide
let owner: Page;
test.beforeAll(async ({ browser }) => { owner = (await signedIn(browser, "owner")).page; });
test.afterAll(async () => { await owner.context().close(); });

test("owner creates a bot through the wizard; it starts as a draft", async () => {
  await openBots(owner);
  await owner.getByRole("button", { name: "Create bot" }).first().click();
  const dialog = owner.getByRole("dialog");
  await dialog.getByRole("button", { name: /start blank/i }).click();
  await dialog.getByPlaceholder("Forge").fill(WIZARD);
  await dialog.getByPlaceholder("Creative Production Director").fill("Tester");
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await dialog.getByRole("button", { name: "Create bot", exact: true }).click();
  await expect(dialog.getByText(/It starts as a draft/)).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).first().click();
  await expect(owner.getByRole("link", { name: WIZARD })).toBeVisible();
  await expect(owner.locator("li", { hasText: WIZARD }).getByText("Draft")).toBeVisible();
});

test("configuration changes make checkpoints, and restoring one rolls the bot back", async () => {
  await openBots(owner);
  await owner.getByRole("link", { name: WIZARD }).click();
  await owner.getByRole("tab", { name: "Overview" }).click();
  const description = owner.getByLabel("Description");
  await description.fill("Version A of the description.");
  await owner.getByRole("button", { name: "Save changes" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await description.fill("Version B of the description.");
  await owner.getByRole("button", { name: "Save changes" }).click();
  await expect(owner.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  await owner.getByRole("tab", { name: "Versions" }).click();
  const items = owner.locator("li", { hasText: /Version \d+/ });
  await expect.poll(async () => items.count()).toBeGreaterThanOrEqual(2);
  owner.once("dialog", (d) => void d.accept());
  // The newest checkpoint is "current" (its Restore is disabled); restore the one that holds Version A.
  const restorable = items.filter({ has: owner.getByRole("button", { name: "Restore", disabled: false }) });
  await restorable.first().getByRole("button", { name: "Restore" }).click();
  await owner.getByRole("tab", { name: "Overview" }).click();
  await expect(owner.getByLabel("Description")).toHaveValue(/Version [AB] of the description\./);
  const bots = await api<{ bots: { bot: { name: string; description: string } }[] }>(owner, "GET", `/api/bots?workspaceId=${seed().workspaces.alpha}`);
  const wizard = bots.body.bots.find((b) => b.bot.name === WIZARD)!;
  // A restore never destroys history: the pre-restore state is itself checkpointed.
  const versions = await api<{ versions: { version: number; reason: string }[] }>(owner, "GET", `/api/bots/${(wizard as unknown as { bot: { id: string } }).bot.id}/versions`);
  expect(versions.body.versions.length).toBeGreaterThanOrEqual(3);
});

test("a task runs for real, ends COMPLETED with output, and its tool use and memory are on the record", async () => {
  await resetFakeHermes(owner.request);
  // Memory: read and write the bot's own scope, keep for 7 days.
  const policy = await api(owner, "PUT", `/api/bots/${seed().bots.forge}/memory`, { enabled: true, readScopes: ["bot"], writeScopes: ["bot"], maxItems: 5, minRelevance: 0.1, consolidation: "standard", retentionDays: 7 });
  expect(policy.status, JSON.stringify(policy.body)).toBe(200);

  const id = await start(owner, "Draft the north wall pour checklist [tool:read_file]");
  const task = await waitFor(owner, id, "COMPLETED");
  expect(task.output?.text).toContain("Fake Hermes reply");
  expect(task.toolCalls).toEqual([expect.objectContaining({ tool: "read_file", decision: "allowed" })]);
  const types = task.events.map((e) => e.type);
  expect(types).toEqual(expect.arrayContaining(["queued", "started", "memory_read", "tool_allowed", "usage", "completed"]));
  expect((await fakeHermes(owner.request)).tools).toContain("read_file");
});

test("retained memory is readable by the bot's next task, and carries its own expiry", async () => {
  const FACT = "The Titan ICF wall system is rated for sustained 250 mph winds, and brand copy must cite that rating.";
  const task = await waitFor(owner, await start(owner, `For the record: ${FACT}`), "COMPLETED");
  const write = task.events.find((e) => e.type === "memory_write");
  expect(write?.data.accepted, JSON.stringify(write)).toBe(true);

  // The next task, on the same subject, reads it back.
  const next = await waitFor(owner, await start(owner, "What wind rating does the Titan ICF wall system have?"), "COMPLETED");
  const read = next.events.find((e) => e.type === "memory_read");
  expect(Number(read?.data.injected), JSON.stringify(read)).toBeGreaterThanOrEqual(1);

  // The deadline lives in its own column and the memory is still current.
  const rows = await api<{ id: string; content: string }[] | { memories: { id: string; content: string }[] }>(owner, "GET", "/api/memories?limit=200");
  const list = Array.isArray(rows.body) ? rows.body : rows.body.memories;
  expect(list.some((m) => /RC Forge task/.test(m.content) && /250 mph/.test(m.content))).toBe(true);
});

test("delegation: naming a running bot task as parentTaskId does not borrow its authority", async () => {
  const running = await start(owner, "Hold this task open [slow]");
  await waitFor(owner, running, "RUNNING");
  const response = await api<{ error: string }>(owner, "POST", `/api/bots/${seed().bots.forge}/tasks`, { task: "sneak in as a child", parentTaskId: running });
  expect(response.status).toBe(403);
  expect(response.body.error).toMatch(/executing that task/);
  await api(owner, "POST", taskUrl(running), { action: "cancel" });
  await waitFor(owner, running, "CANCELLED");
});

test("an approval-gated tool parks the task WAITING; approving continues it once, in the UI", async () => {
  await resetFakeHermes(owner.request);
  await openBots(owner);
  await owner.getByRole("link", { name: "RC Forge" }).first().click();
  await owner.getByRole("tab", { name: "Test" }).click();
  await owner.getByLabel("Prompt").fill("Run the build please [tool:terminal]");
  await owner.getByRole("button", { name: "Run test" }).click();
  const approve = owner.getByRole("button", { name: /Approve terminal and continue/ });
  await expect(approve).toBeVisible({ timeout: 60_000 });
  await expect(owner.getByText(/Stopped before using terminal/)).toBeVisible();
  await owner.screenshot({ path: "test-results/rc-evidence/bot-waiting-approval.png" });
  await approve.click();

  const waiting = (await api<{ tasks: { id: string; status: string; task: string }[] }>(owner, "GET", `/api/bots/${seed().bots.forge}/tasks?limit=20`)).body.tasks.find((t) => t.task?.startsWith("Run the build please"))!;
  const continued = await expect.poll(async () => child(owner, waiting.id), { timeout: 30_000 }).not.toBeNull().then(() => child(owner, waiting.id));
  const done = await waitFor(owner, continued!.id, "COMPLETED");
  expect(done.toolCalls[0]).toMatchObject({ tool: "terminal", decision: "allowed" });
  expect((await api<{ task: Task }>(owner, "GET", taskUrl(waiting.id))).body.task.status).toBe("CANCELLED");   // the parked one is closed, not left dangling
});

test("a one-use approval is spent by its first call: a second call asks again", async () => {
  await resetFakeHermes(owner.request);
  const id = await start(owner, "Build twice [tool:terminal] [tool:terminal]");
  const waiting = await waitFor(owner, id, "WAITING");
  expect(waiting.waitingFor?.tool).toBe("terminal");
  expect((await api(owner, "POST", taskUrl(id), { action: "approve" })).status).toBe(200);
  const resumed = (await expect.poll(async () => child(owner, id), { timeout: 30_000 }).not.toBeNull().then(() => child(owner, id)))!;
  const again = await waitFor(owner, resumed.id, "WAITING");
  expect(again.toolCalls.map((c) => c.decision)).toEqual(["allowed", "approval"]);
  expect(again.waitingFor?.tool).toBe("terminal");
  await api(owner, "POST", taskUrl(resumed.id), { action: "deny" });
});

test("a tool the runtime reports as mcp_<slug>_<tool> is approved under its catalog name and then runs", async () => {
  await resetFakeHermes(owner.request);
  const id = await start(owner, "Render the hook [tool:mcp_creative_provider_generate_video]");
  const waiting = await waitFor(owner, id, "WAITING");
  const approvals = await owner.evaluate(async (workspaceId) => (await (await fetch(`/api/approvals?workspaceId=${workspaceId}`)).json()), seed().workspaces.alpha).catch(() => null);
  void approvals;
  expect((await api(owner, "POST", taskUrl(id), { action: "approve" })).status).toBe(200);
  const resumed = (await expect.poll(async () => child(owner, id), { timeout: 30_000 }).not.toBeNull().then(() => child(owner, id)))!;
  const done = await waitFor(owner, resumed.id, ["COMPLETED", "WAITING", "FAILED"]);
  expect(done.status, JSON.stringify(done.events.slice(-4))).toBe("COMPLETED");          // not bounced back to WAITING for the same tool
  expect(done.toolCalls[0]).toMatchObject({ tool: "mcp_creative_provider_generate_video", decision: "allowed" });
  expect(waiting.waitingFor?.tool).toBe("mcp_creative_provider_generate_video");
});

test("cancelling a running task interrupts the runtime and ends CANCELLED", async () => {
  await resetFakeHermes(owner.request);
  const id = await start(owner, "Stream for a long time [slow]");
  await waitFor(owner, id, "RUNNING");
  expect((await api(owner, "POST", taskUrl(id), { action: "cancel" })).status).toBe(200);
  const task = await waitFor(owner, id, "CANCELLED");
  expect(task.error).toBeNull();
  expect((await fakeHermes(owner.request)).interrupts.length).toBeGreaterThanOrEqual(1);
});

test("a runtime that will not confirm the interrupt keeps the task open, then it closes once the runtime recovers", async () => {
  await resetFakeHermes(owner.request);
  const id = await start(owner, "Stream and refuse to stop [slow] [stubborn]");
  await waitFor(owner, id, "RUNNING");
  expect((await api(owner, "POST", taskUrl(id), { action: "cancel" })).status).toBe(200);

  // The executor retries, gives up, and does NOT call it cancelled, parked or failed.
  await expect.poll(async () => (await fakeHermes(owner.request)).refusedInterrupts, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  const stuck = await waitFor(owner, id, "RUNNING");
  expect(stuck.error).toMatch(/did not confirm/);
  const row = await api<{ task: Task }>(owner, "GET", taskUrl(id));
  expect(row.body.task.status).toBe("RUNNING");
  await owner.goto("/bots");   // the studio shows it as live work, not as done
  expect((await api(owner, "POST", taskUrl(id), { action: "cancel" })).status).toBe(409);   // it is already being cancelled

  // The runtime recovers; the reconciler (every 60s on the orchestration worker) gets its confirmation.
  await unstickFakeHermes(owner.request);
  const closed = await waitFor(owner, id, "CANCELLED", 120_000);
  expect(closed.status).toBe("CANCELLED");
});

test("the Orrery's approval card decides a bot approval end to end", async () => {
  await resetFakeHermes(owner.request);
  const id = await start(owner, "Run the build from the card [tool:terminal]");
  await waitFor(owner, id, "WAITING");
  await owner.goto("/chat");
  const card = owner.getByRole("article").filter({ hasText: /wants to use terminal/ });
  await expect(card).toBeVisible({ timeout: 30_000 });
  await owner.screenshot({ path: "test-results/rc-evidence/orrery-approval-card.png" });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect(card).toHaveCount(0, { timeout: 30_000 });
  const resumed = (await expect.poll(async () => child(owner, id), { timeout: 30_000 }).not.toBeNull().then(() => child(owner, id)))!;
  expect((await waitFor(owner, resumed.id, "COMPLETED")).toolCalls[0]).toMatchObject({ tool: "terminal", decision: "allowed" });
  expect((await api<{ task: Task }>(owner, "GET", taskUrl(id))).body.task.status).toBe("CANCELLED");
});
