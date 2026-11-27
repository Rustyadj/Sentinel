import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { expect, test } from "@playwright/test";
import { api, seed, signedIn } from "./support";

const exec = promisify(execFile);
const endpoint = "http://workforce-browser.test/form";
const restartStackServices = () => exec("docker", [
  "compose", "-f", "deploy/verify/docker-compose.yml", "restart", "browser", "app",
], { timeout: 45_000 });

test("browser runs in the release image and recovers its authenticated storage after restart", async ({ browser, request }) => {
  test.setTimeout(120_000);
  const db = new PrismaClient({ datasourceUrl: "postgresql://rc:rc-disposable@127.0.0.1:55510/rc" });
  const { users, workspaces } = seed();
  const browserWorkspace = await db.agentWorkspace.create({
    data: { agentId: "hermes-lisa", ownerUserId: users.owner, workspaceId: workspaces.alpha, name: "Browser recovery", slug: "browser-recovery", resourceLimits: { network: "bridge" } },
  });
  const otherWorkspace = await db.agentWorkspace.create({
    data: { agentId: "hermes-lisa", ownerUserId: users.owner, workspaceId: workspaces.alpha, name: "Browser isolation", slug: "browser-isolation", resourceLimits: { network: "bridge" } },
  });
  const { context, page } = await signedIn(browser, "owner");
  const route = `/api/agent-workspaces/${browserWorkspace.id}/browser`;
  type Session = { sessionId: string; startedAt: string; currentUrl: string | null };
  try {
    await expect.poll(async () => (await api<{ attached: boolean }>(page, "GET", route + "?status=true")).body.attached).toBe(true);
    const created = await api<{ session: Session }>(page, "POST", route, { action: "create" });
    expect(created.status).toBe(201);
    const { sessionId, startedAt } = created.body.session;
    const navigate = await api<{ navigation: { status: number } }>(page, "POST", route, { action: "navigate", sessionId, url: endpoint });
    expect(navigate.status).toBe(200);
    expect(navigate.body.navigation.status).toBe(200);

    const firstRun = await api(page, "POST", route, { action: "workflow", sessionId, steps: [
      { kind: "fill", selector: "input", value: "Titan ICF" },
      { kind: "click", selector: "button" },
      { kind: "extract", selector: "output" },
    ] });
    expect(firstRun.body).toMatchObject({ workflow: { status: "completed", results: [{}, {}, { text: "Titan ICF" }] } });
    const screenshot = await context.request.get(route + "?sessionId=" + sessionId);
    expect(screenshot.status()).toBe(200);
    expect((await screenshot.body()).subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");

    expect((await api(page, "POST", `/api/agent-workspaces/${otherWorkspace.id}/browser`, {
      action: "navigate", sessionId, url: endpoint,
    })).status).toBe(404);

    const refused = await api<{ navigation: { status: number } }>(page, "POST", route, {
      action: "navigate", sessionId, url: "http://postgres:5432",
    });
    expect(refused.body.navigation.status).toBe(403);
    expect((await api(page, "POST", route, { action: "navigate", sessionId, url: endpoint })).status).toBe(200);

    await restartStackServices();
    await expect.poll(async () => request.get("/api/health").then((response) => response.ok()).catch(() => false), { timeout: 30_000 }).toBe(true);
    const restored = await api<{ session: Session }>(page, "POST", route, { action: "create" });
    expect(restored.status).toBe(201);
    expect(restored.body.session).toMatchObject({ sessionId, startedAt, currentUrl: endpoint });
    const secondRun = await api(page, "POST", route, { action: "workflow", sessionId, steps: [
      { kind: "extract", selector: "body[data-cookie='browser_fixture=present'] output" },
    ] });
    expect(secondRun.body).toMatchObject({ workflow: { status: "completed", results: [{ text: "Titan ICF" }] } });

    expect((await api(page, "DELETE", route + "?sessionId=" + sessionId)).status).toBe(200);
    const replacement = await api<{ session: Session }>(page, "POST", route, { action: "create" });
    expect(replacement.status).toBe(201);
    expect(replacement.body.session).toMatchObject({ currentUrl: null });
    expect(replacement.body.session.sessionId).not.toBe(sessionId);
    expect((await api(page, "DELETE", route + "?sessionId=" + replacement.body.session.sessionId)).status).toBe(200);
  } finally {
    await context.close();
    await db.$disconnect();
  }
});
