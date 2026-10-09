import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";

export interface Seed {
  password: string;
  users: { owner: string; member: string; outsider: string };
  workspaces: { alpha: string; bravo: string };
  project: string;
  mcpProvider: string;
  bots: { forge: string; bravo: string };
  graphNodeIds: string[];
}
export const seed = (): Seed => JSON.parse(readFileSync(resolve(__dirname, ".seed.json"), "utf8"));

export type Persona = "owner" | "member" | "outsider";
export const EMAIL: Record<Persona, string> = { owner: "owner@rc.test", member: "member@rc.test", outsider: "outsider@rc.test" };

/** A fresh browser context signed in through the real sign-in form. */
export async function signedIn(browser: Browser, persona: Persona): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/auth/signin");
  await page.getByPlaceholder("Email").fill(EMAIL[persona]);
  await page.getByPlaceholder("Password").fill(seed().password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/auth/signin"), { timeout: 30_000 });
  return { context, page };
}

/** What the fake Hermes saw — prompts, tools and interrupts that reached the "agent". */
export async function fakeHermes(request: APIRequestContext): Promise<{ prompts: string[]; tools: string[]; interrupts: string[]; refusedInterrupts: number }> {
  return (await request.get("http://127.0.0.1:4900/__calls")).json();
}
export const resetFakeHermes = (request: APIRequestContext) => request.post("http://127.0.0.1:4900/__reset");
export const unstickFakeHermes = (request: APIRequestContext) => request.post("http://127.0.0.1:4900/__unstick");

/** Poll a JSON endpoint from inside the page (with the page's session) until a predicate holds. */
export async function waitForApi<T>(page: Page, url: string, ok: (body: T) => boolean, label: string, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = (await page.evaluate(async (u) => (await fetch(u)).json(), url)) as T;
    if (ok(last)) return last;
    await page.waitForTimeout(500);
  }
  expect(last, `${label}: timed out waiting on ${url}`).toBeUndefined();
  return last as T;
}

export async function api<T = unknown>(page: Page, method: string, url: string, body?: unknown): Promise<{ status: number; body: T }> {
  return page.evaluate(async ({ method, url, body }) => {
    const response = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: response.status, body: parsed as never };
  }, { method, url, body });
}

/** Open Bot Studio on a named workspace (the page defaults to the first workspace the user belongs to). */
export async function openBots(page: Page, workspaceName = "RC Alpha") {
  await page.goto("/bots");
  const picker = page.locator(`select[aria-label="Workspace"]`);
  if (await picker.count()) await picker.selectOption({ label: workspaceName });
}
