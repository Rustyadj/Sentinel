// Server-side only. The `server-only` marker package is deliberately not used:
// it is unresolvable outside the Next bundler, which breaks the Node entry
// points that legitimately drive workspaces (the acceptance script, cron and
// worker processes). These modules import Node built-ins, so a client import
// fails loudly on its own.
import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import type {
  BrowserRuntimeStatus,
  BrowserSession,
  WorkspaceBrowserProvider,
} from "../browser";
import { runBrowserWorkflow, type BrowserWorkflow } from "../browser-workflow";
import { WorkspaceError } from "../errors";

interface LiveSession extends BrowserSession {
  context: BrowserContext;
  page: Page;
  downloadDirectory: string;
  operationRunning?: boolean;
}

interface PlaywrightProcessState {
  browser: Browser | null;
  launchPromise: Promise<Browser> | null;
  probe: "pending" | "available" | "unavailable";
  reason?: string;
  sessionsByWorkspace: Map<string, LiveSession>;
  sessionsById: Map<string, LiveSession>;
}

const STATE_KEY = Symbol.for("sentinel.agent-workspaces.playwright");
const stateHost = globalThis as typeof globalThis & { [STATE_KEY]?: PlaywrightProcessState };
const state: PlaywrightProcessState = stateHost[STATE_KEY] ??= {
  browser: null,
  launchPromise: null,
  probe: "pending",
  sessionsByWorkspace: new Map(),
  sessionsById: new Map(),
};

const workflowProxy = process.env.SENTINEL_BROWSER_WORKFLOW_PROXY?.trim();
const DOWNLOAD_ROOT = path.join(tmpdir(), "sentinel-browser-downloads");

function unavailable(message: string, detail?: string): WorkspaceError {
  return new WorkspaceError(message, "runtime_unavailable", detail);
}

function describeLaunchFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/executable doesn.t exist|browser.*not found|playwright install/i.test(message)) {
    return "Playwright Chromium is not installed on this host. Run the Playwright browser install step during deployment.";
  }
  return `Playwright Chromium could not launch: ${message.split("\n")[0]}`;
}

async function launchBrowser(): Promise<Browser> {
  if (state.browser?.isConnected()) return state.browser;
  if (state.launchPromise) return state.launchPromise;
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    const reason = "Playwright is disabled because the Sentinel server process is running as root.";
    state.probe = "unavailable";
    state.reason = reason;
    throw unavailable(reason);
  }

  state.launchPromise = chromium.launch({
    headless: true,
    ...(workflowProxy ? {
      proxy: { server: workflowProxy, bypass: "<-loopback>" },
      args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
    } : {}),
  })
    .then((browser) => {
      state.browser = browser;
      state.probe = "available";
      state.reason = undefined;
      browser.on("disconnected", () => {
        if (state.browser === browser) state.browser = null;
        state.sessionsById.clear();
        state.sessionsByWorkspace.clear();
        state.probe = "pending";
        state.reason = undefined;
        void launchBrowser().catch(() => undefined);
      });
      return browser;
    })
    .catch((error: unknown) => {
      state.probe = "unavailable";
      state.reason = describeLaunchFailure(error);
      throw unavailable(state.reason, error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      state.launchPromise = null;
    });
  return state.launchPromise;
}

function publicSession(session: LiveSession): BrowserSession {
  return {
    sessionId: session.sessionId,
    workspaceId: session.workspaceId,
    startedAt: session.startedAt,
    currentUrl: session.currentUrl,
  };
}

function requireSession(sessionId: string) {
  const session = state.sessionsById.get(sessionId);
  if (!session) throw new WorkspaceError("Browser session not found. Create one first.", "runtime_not_found");
  return session;
}

async function withBrowserOperation<T>(sessionId: string, perform: (session: LiveSession) => Promise<T>) {
  const session = requireSession(sessionId);
  if (session.operationRunning) throw new WorkspaceError("A browser operation is in progress.", "policy_violation");
  session.operationRunning = true;
  try {
    return await perform(session);
  } finally {
    session.currentUrl = session.page.url();
    session.operationRunning = false;
  }
}

function requireHttpUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError("A valid browser URL is required.", "invalid_body");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WorkspaceError("Browser navigation only supports HTTP and HTTPS URLs.", "invalid_body");
  }
  return parsed.toString();
}

async function safeDownloadPath(session: LiveSession, requested: string) {
  await mkdir(session.downloadDirectory, { recursive: true, mode: 0o700 });
  const root = await realpath(session.downloadDirectory);
  const filename = path.basename(requested).replace(/[^a-zA-Z0-9._-]/g, "_") || "download";
  const target = path.join(root, `${randomUUID()}-${filename}`);
  if (!target.startsWith(`${root}${path.sep}`)) {
    throw new WorkspaceError("Invalid browser download destination.", "path_escape");
  }
  return target;
}

class PlaywrightBrowserProvider implements WorkspaceBrowserProvider {
  readonly id = "playwright";

  constructor() {
    // Probe immediately, but never make a server import fail merely because a
    // deployment omitted browser binaries. Status stays honest while pending.
    void launchBrowser().catch(() => undefined);
  }

  runtimeStatus(): BrowserRuntimeStatus {
    if (state.probe === "available" && state.browser?.isConnected()) {
      return { attached: true, provider: this.id };
    }
    return {
      attached: false,
      provider: null,
      reason: state.probe === "pending"
        ? "Playwright Chromium launch probe is still running."
        : state.reason ?? "Playwright Chromium is unavailable.",
    };
  }

  async createSession(workspaceId: string): Promise<BrowserSession> {
    const existing = state.sessionsByWorkspace.get(workspaceId);
    if (existing && !existing.page.isClosed()) return publicSession(existing);

    const browser = await launchBrowser();
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const session: LiveSession = {
      sessionId: randomUUID(),
      workspaceId,
      startedAt: new Date().toISOString(),
      currentUrl: null,
      context,
      page,
      downloadDirectory: path.join(DOWNLOAD_ROOT, workspaceId),
    };
    state.sessionsByWorkspace.set(workspaceId, session);
    state.sessionsById.set(session.sessionId, session);
    return publicSession(session);
  }

  getSession(sessionId: string): BrowserSession | null {
    const session = state.sessionsById.get(sessionId);
    return session ? publicSession(session) : null;
  }

  navigate(sessionId: string, url: string) {
    return withBrowserOperation(sessionId, async (session) => {
      const response = await session.page.goto(requireHttpUrl(url), { waitUntil: "domcontentloaded" });
      return { url: session.page.url(), status: response?.status() ?? 0 };
    });
  }

  async screenshot(sessionId: string, fullPage: boolean) {
    const session = requireSession(sessionId);
    const data = await session.page.screenshot({ type: "png", fullPage });
    return { contentType: "image/png", data: Buffer.from(data) };
  }

  download(sessionId: string, url: string, destinationPath: string) {
    return withBrowserOperation(sessionId, async (session) => {
      const target = await safeDownloadPath(session, destinationPath);
      const [download] = await Promise.all([
        session.page.waitForEvent("download", { timeout: 30_000 }),
        session.page.goto(requireHttpUrl(url), { waitUntil: "commit" }).catch((error: unknown) => {
          if (!/download is starting/i.test(error instanceof Error ? error.message : String(error))) throw error;
        }),
      ]);
      const failure = await download.failure();
      if (failure) throw new WorkspaceError("Browser download failed.", "command_failed", failure);
      await download.saveAs(target);
      return { path: target, sizeBytes: (await stat(target)).size };
    });
  }

  upload(sessionId: string, selector: string, sourcePath: string) {
    return withBrowserOperation(sessionId, async (session) => {
      const root = await realpath(session.downloadDirectory).catch(() => "");
      const source = await realpath(sourcePath).catch(() => "");
      if (!root || !source.startsWith(`${root}${path.sep}`)) {
        throw new WorkspaceError("Uploads may only use files created by this browser session.", "path_escape");
      }
      await session.page.locator(selector).setInputFiles(source);
    });
  }

  async getCookies(sessionId: string) {
    const cookies = await requireSession(sessionId).context.cookies();
    return cookies.map(({ name, domain, path: cookiePath, expires }) => ({
      name,
      domain,
      path: cookiePath,
      expires: expires < 0 ? null : expires,
    }));
  }

  async runWorkflow(sessionId: string, actions: BrowserWorkflow) {
    if (!workflowProxy) {
      throw unavailable("Browser workflows require the deployment's isolated browser egress proxy.");
    }
    return withBrowserOperation(sessionId, (session) => runBrowserWorkflow(session.page, actions));
  }

  async closeSession(sessionId: string) {
    const session = requireSession(sessionId);
    await session.context.close();
    state.sessionsById.delete(sessionId);
    if (state.sessionsByWorkspace.get(session.workspaceId)?.sessionId === sessionId) {
      state.sessionsByWorkspace.delete(session.workspaceId);
    }
  }
}

export const playwrightBrowserProvider: WorkspaceBrowserProvider = new PlaywrightBrowserProvider();
