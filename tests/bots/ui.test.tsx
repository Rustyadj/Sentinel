import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { BotsPage } from "@/modules/bots/components/BotsPage";
import { BOT_TEMPLATES } from "@/lib/bots/templates";

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handlers: Handler[] = []; let calls: { url: string; method: string; body: any }[] = [];
const ok = (body: unknown) => ({ body });

beforeEach(() => {
  calls = []; handlers = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    for (const handler of handlers) { const result = handler(url, init); if (result) return { ok: (result.status ?? 200) < 400, status: result.status ?? 200, json: async () => result.body }; }
    return { ok: false, status: 404, json: async () => ({ error: `unmocked ${url}` }) };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const WS = [{ id: "ws1", name: "Titan" }];
const meta = { hosts: [{ agentId: "hermes-lisa", kind: "hermes", executionVerified: true, health: { ready: true } }], models: { choices: ["gpt-5.6-luna"], inherited: { model: "gpt-5.6-luna" }, unsupported: ["temperature"] }, templates: BOT_TEMPLATES, memoryScopes: ["bot", "session", "project", "workspace", "organization", "user", "global"], toolPermissions: [], callers: { agents: [], clients: [] } };
const summary = (over: Record<string, unknown> = {}) => ({
  bot: { id: "b1", name: "Forge", role: "Creative Production Director", description: "Makes short-form ads.", avatar: "clapperboard", color: "#f59e0b", status: "active", modelConfig: { primary: "gpt-5.6-luna" }, runtimeAgentId: "hermes-lisa", tags: [] },
  host: { agentId: "hermes-lisa", enabled: true, executionVerified: true },
  skills: [{ id: "s1", name: "hook-writer", enabled: true }], servers: [{ id: "gen", name: "Creative Provider", tools: 2 }],
  memory: { enabled: true, read: ["bot", "project"], write: ["bot"] }, lastActiveAt: new Date(Date.now() - 3_600_000).toISOString(),
  currentTask: { id: "t1", task: "Cut the hurricane reel", status: "running" }, usageToday: { tokens: 4200, costUsd: 0, pricedTasks: 0, tasks: 2 }, ...over,
});
const list = (bots: unknown[]) => { handlers.push((url) => (url.startsWith("/api/bots?") ? ok({ bots }) : url.startsWith("/api/bots/meta") ? ok(meta) : undefined)); };

describe("Bots screen", () => {
  it("shows a loading skeleton, then a card with the fields the spec asks for", async () => {
    list([summary()]);
    render(<BotsPage workspaces={WS} />);
    expect(screen.getByLabelText("Loading bots")).toBeInTheDocument();
    const card = (await screen.findByRole("link", { name: "Forge" })).closest("li")!;
    const view = within(card);
    expect(view.getByText("Creative Production Director")).toBeInTheDocument();
    expect(view.getByText("Enabled")).toBeInTheDocument();          // status as text, not colour alone
    expect(view.getByText("gpt-5.6-luna")).toBeInTheDocument();     // base model
    await waitFor(() => expect(view.getByText("Hermes ready")).toBeInTheDocument());
    expect(view.getByText("hook-writer")).toBeInTheDocument();      // enabled skills
    expect(view.getByText(/Creative Provider \(2\)/)).toBeInTheDocument(); // connected servers/tools
    expect(view.getByText(/Reads This bot only, Project/)).toBeInTheDocument(); // memory status
    expect(view.getByText(/about 1 hour ago/)).toBeInTheDocument(); // last active
    expect(view.getByText(/Working: Cut the hurricane reel/)).toBeInTheDocument(); // current task
    expect(view.getByText("4,200 tokens, not priced")).toBeInTheDocument(); // usage without an invented cost
    for (const name of ["Test", "Edit", "Activity", "Duplicate", "Disable", "Delete"]) expect(view.getByText(name)).toBeInTheDocument();
  });

  it("says a host is not verified rather than implying it works", async () => {
    list([summary({ host: { agentId: "hermes-lisa", enabled: true, executionVerified: false } })]);
    render(<BotsPage workspaces={WS} />);
    expect(await screen.findByText("Host not verified")).toBeInTheDocument();
  });

  it("explains an empty workspace and offers the next step", async () => {
    list([]);
    render(<BotsPage workspaces={WS} />);
    expect(await screen.findByText("No bots in this workspace yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create the first bot" })).toBeInTheDocument();
  });

  it("names what failed and offers Retry, keeping the layout", async () => {
    handlers.push((url) => (url.startsWith("/api/bots?") ? { status: 500, body: { error: "Unexpected error" } } : undefined));
    render(<BotsPage workspaces={WS} />);
    expect(await screen.findByText(/Could not load bots: Unexpected error/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /create bot/i })).toBeInTheDocument();
  });

  it("deleting needs an explicit second click naming the bot", async () => {
    list([summary()]);
    handlers.push((url, init) => (url === "/api/bots/b1" && init?.method === "DELETE" ? ok({ ok: true }) : undefined));
    render(<BotsPage workspaces={WS} />);
    await screen.findByRole("link", { name: "Forge" });
    await userEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Delete Forge" }));
    await waitFor(() => expect(calls.some((c) => c.method === "DELETE")).toBe(true));
  });
});

describe("Create bot wizard", () => {
  const open = async () => { list([]); handlers.push((url) => (url.startsWith("/api/bots/meta") ? ok(meta) : undefined)); render(<BotsPage workspaces={WS} />); await userEvent.click(await screen.findByRole("button", { name: "Create bot" })); await screen.findByText("Or start from a template"); };

  it("template grants are shown ticked, everything else stays off, and only ticked grants are sent", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: /Creative production bot/ }));
    await userEvent.click(screen.getByRole("button", { name: "Use this" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Forge");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const webSearch = screen.getByRole("checkbox", { name: /web_search/ });
    expect(webSearch).toBeChecked();
    await userEvent.click(webSearch);                     // the creator turns one off
    handlers.push((url, init) => (url === "/api/bots" && init?.method === "POST" ? ok({ bot: { id: "new1" } }) : undefined));
    await userEvent.click(screen.getByRole("button", { name: "Create bot" }));
    const post = await waitFor(() => { const c = calls.find((x) => x.url === "/api/bots" && x.method === "POST"); if (!c) throw new Error("no post"); return c; });
    expect(post.body.toolGrants).toEqual([{ serverId: "hermes-builtin", toolName: "read_file", permission: "read" }]);
    expect(post.body).toMatchObject({ name: "Forge", templateId: "creative-production", runtimeAgentId: "hermes-lisa", workspaceId: "ws1" });
    expect(post.body.memoryPolicy.writeScopes).toEqual(["bot"]);
    expect(post.body.status).toBeUndefined();             // created as a draft
    expect(await screen.findByRole("link", { name: "Test bot" })).toHaveAttribute("href", "/bots/new1?tab=test");
  });

  it("an AI proposal fills the form for review, and its suggested tools arrive UNTICKED", async () => {
    await open();
    handlers.push((url, init) => (url === "/api/bots/generate" && init?.method === "POST" ? ok({ proposal: {
      fields: { name: "Reelsmith", role: "Ad Director", description: "Makes ads.", systemPrompt: "Be bold.", mission: "Ship.", responsibilities: ["Hooks"], constraints: [], outputPreferences: "", workflow: [], capabilities: ["video-generation"], tags: [] },
      suggestedGrants: [{ serverId: "gen", serverName: "Creative Provider", toolName: "generate_video", permission: "approval", why: "spends credits" }], suggestedSkills: [], dropped: ['server "Higgsfield"'], hostAgentId: "hermes-lisa" } }) : undefined));
    await userEvent.type(screen.getByLabelText(/Describe the bot/), "Create a bot that makes incredible short-form video ads using Higgsfield.");
    await userEvent.click(screen.getByRole("button", { name: /Generate bot instructions/ }));
    expect(await screen.findByText(/Proposed from your description/)).toBeInTheDocument();
    expect(screen.getByText(/Not used because they do not exist here: server "Higgsfield"/)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Reelsmith");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    const suggested = screen.getByRole("checkbox", { name: /generate_video/ });
    expect(suggested).not.toBeChecked();
    handlers.push((url, init) => (url === "/api/bots" && init?.method === "POST" ? ok({ bot: { id: "new2" } }) : undefined));
    await userEvent.click(screen.getByRole("button", { name: "Create bot" }));
    const post = await waitFor(() => { const c = calls.find((x) => x.url === "/api/bots" && x.method === "POST"); if (!c) throw new Error("no post"); return c; });
    expect(post.body.toolGrants).toEqual([]);             // nothing granted from a natural-language description
  });

  it("shows a generation failure without discarding what the user typed", async () => {
    await open();
    handlers.push((url) => (url === "/api/bots/generate" ? { status: 503, body: { error: "No verified Hermes runtime is ready, so instructions cannot be generated right now." } } : undefined));
    const box = screen.getByLabelText(/Describe the bot/);
    await userEvent.type(box, "A bot that researches competitors on the web");
    await userEvent.click(screen.getByRole("button", { name: /Generate bot instructions/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/No verified Hermes runtime is ready/);
    expect(box).toHaveValue("A bot that researches competitors on the web");
  });

  it("will not advance from Identity without a name", async () => {
    await open();
    await userEvent.click(screen.getByRole("button", { name: "Start blank" }));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Scratch" } });
    expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
  });
});

describe("Bots page for someone who cannot manage bots", () => {
  it("says so plainly and offers no Create button, instead of a button above a Forbidden error", async () => {
    handlers.push((url) => (url.startsWith("/api/bots?") ? { status: 403, body: { error: "Forbidden: requires owner or admin" } } : undefined));
    render(<BotsPage workspaces={WS} />);
    expect(await screen.findByText(/Bot Studio is for workspace owners and admins/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /create bot/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Could not load bots/)).not.toBeInTheDocument();
  });
});
