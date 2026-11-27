// Server-side only. The `server-only` marker package is deliberately not used:
// it is unresolvable outside the Next bundler, which breaks the Node entry
// points that legitimately drive workspaces (the acceptance script, cron and
// worker processes). These modules import Node built-ins, so a client import
// fails loudly on its own.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, realpath, rm, stat } from "node:fs/promises";
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
import { deleteBrowserCheckpoint, readBrowserCheckpoint, writeBrowserCheckpoint, type BrowserCheckpoint } from "./browser-checkpoint";

interface LiveSession extends BrowserSession {
  context: BrowserContext;
  page: Page;
  downloadDirectory: string;
}

interface PlaywrightProcessState {
  browser: Browser | null;
  launchPromise: Promise<Browser> | null;
  probe: "pending" | "available" | "unavailable";
  reason?: string;
  retryProbeAt?: number;
  sessionsByWorkspace: Map<string, LiveSession>;
  busyWorkspaces: Set<string>;
}

const STATE_KEY = Symbol.for("sentinel.agent-workspaces.playwright");
const stateHost = globalThis as typeof globalThis & { [STATE_KEY]?: PlaywrightProcessState };
const state: PlaywrightProcessState = stateHost[STATE_KEY] ??= {
  browser: null,
  launchPromise: null,
  probe: "pending",
  sessionsByWorkspace: new Map(),
  busyWorkspaces: new Set(),
};

const browserEndpoint = process.env.SENTINEL_BROWSER_WS_ENDPOINT?.trim();
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

  if (process.env.NODE_ENV === "production" && !browserEndpoint) {
    const reason = "Configure the isolated Sentinel browser service to enable browser execution.";
    state.probe = "unavailable";
    state.reason = reason;
    throw unavailable(reason);
  }

  const connect = browserEndpoint
    ? chromium.connect(browserEndpoint, { timeout: 5_000 })
    : chromium.launch({
      headless: true,
      ...(workflowProxy ? {
        proxy: { server: workflowProxy, bypass: "<-loopback>" },
        args: ["--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
      } : {}),
    });
  state.launchPromise = connect
    .then((browser) => {
      state.browser = browser;
      state.probe = "available";
      state.reason = undefined;
      browser.on("disconnected", () => {
        if (state.browser !== browser) return;
        state.browser = null;
        state.sessionsByWorkspace.clear();
        state.probe = "pending";
        state.reason = undefined;
        void launchBrowser().catch(() => undefined);
      });
      return browser;
    })
    .catch((error: unknown) => {
      state.probe = "unavailable";
      state.retryProbeAt = Date.now() + 5_000;
      state.reason = browserEndpoint ? "The isolated Sentinel browser service is unreachable." : describeLaunchFailure(error);
      throw unavailable(state.reason);
    })
    .finally(() => {
      state.launchPromise = null;
    });
  return state.launchPromise;
}

function publicSession(session: BrowserSession): BrowserSession {
  return {
    sessionId: session.sessionId,
    workspaceId: session.workspaceId,
    startedAt: session.startedAt,
    currentUrl: session.currentUrl,
  };
}

function getLiveSession(workspaceId: string) {
  const cached = state.sessionsByWorkspace.get(workspaceId);
  return cached && !cached.page.isClosed() ? cached : null;
}

function missingSession() {
  return new WorkspaceError("Browser session not found for this workspace. Create one first.", "runtime_not_found");
}

async function openSession(workspaceId: string, checkpoint: BrowserCheckpoint | null, reload: boolean) {
  const browser = await launchBrowser();
  const context = await browser.newContext({ acceptDownloads: true, storageState: checkpoint?.storageState });
  try {
    const page = await context.newPage();
    if (reload && checkpoint?.currentUrl) {
      await page.goto(checkpoint.currentUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    }
    const sessionId = checkpoint?.sessionId ?? randomUUID();
    const session: LiveSession = {
      sessionId,
      workspaceId,
      startedAt: checkpoint?.startedAt ?? new Date().toISOString(),
      currentUrl: recoverableUrl(page.url()),
      context,
      page,
      downloadDirectory: path.join(DOWNLOAD_ROOT, createHash("sha256").update(workspaceId).digest("hex"), sessionId),
    };
    if (!checkpoint || reload) await writeBrowserCheckpoint(publicSession(session), context);
    state.sessionsByWorkspace.set(workspaceId, session);
    return session;
  } catch (error) {
    await context.close().catch(() => undefined);
    if (error instanceof WorkspaceError) throw error;
    throw unavailable("The browser page could not be restored. Navigate to a page to continue.");
  }
}

function recoverableUrl(value: string) {
  const url = new URL(value);
  return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
}

async function exclusively<T>(workspaceId: string, perform: () => Promise<T>) {
  if (state.busyWorkspaces.has(workspaceId)) {
    throw new WorkspaceError("A browser operation is in progress.", "runtime_conflict");
  }
  state.busyWorkspaces.add(workspaceId);
  try {
    return await perform();
  } finally {
    state.busyWorkspaces.delete(workspaceId);
  }
}

async function withBrowserOperation<T>(workspaceId: string, sessionId: string, recover: "reload" | "blank" | "none", perform: (session: LiveSession) => Promise<T>) {
  return exclusively(workspaceId, async () => {
    let session = getLiveSession(workspaceId);
    if (session && session.sessionId !== sessionId) throw missingSession();
    if (!session) {
      const checkpoint = await readBrowserCheckpoint(workspaceId);
      if (checkpoint?.sessionId !== sessionId) throw missingSession();
      if (recover === "none") throw new WorkspaceError("Resume the browser session before viewing its contents.", "runtime_not_running");
      session = await openSession(workspaceId, checkpoint, recover === "reload");
    }
    try {
      return await perform(session);
    } finally {
      if (recover !== "none" && !session.page.isClosed()) {
        session.currentUrl = recoverableUrl(session.page.url());
        await writeBrowserCheckpoint(publicSession(session), session.context);
      }
    }
  });
}

function requireHttpUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WorkspaceError("A valid browser URL is required.", "invalid_body");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
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
    if (browserEndpoint && Date.now() >= (state.retryProbeAt ?? 0)) {
      state.retryProbeAt = Date.now() + 5_000;
      void launchBrowser().catch(() => undefined);
    }
    return {
      attached: false,
      provider: null,
      reason: state.probe === "pending"
        ? "Playwright Chromium launch probe is still running."
        : state.reason ?? "Playwright Chromium is unavailable.",
    };
  }

  createSession(workspaceId: string): Promise<BrowserSession> {
    return exclusively(workspaceId, async () => {
      const existing = getLiveSession(workspaceId);
      if (existing) return publicSession(existing);
      const checkpoint = await readBrowserCheckpoint(workspaceId);
      return publicSession(await openSession(workspaceId, checkpoint, true));
    });
  }

  async getSession(workspaceId: string, sessionId: string): Promise<BrowserSession | null> {
    const live = getLiveSession(workspaceId);
    if (live) return live.sessionId === sessionId ? publicSession(live) : null;
    const checkpoint = await readBrowserCheckpoint(workspaceId);
    return checkpoint?.sessionId === sessionId ? publicSession(checkpoint) : null;
  }

  navigate(workspaceId: string, sessionId: string, url: string) {
    return withBrowserOperation(workspaceId, sessionId, "blank", async (session) => {
      const response = await session.page.goto(requireHttpUrl(url), { waitUntil: "domcontentloaded", timeout: 25_000 });
      return { url: session.page.url(), status: response?.status() ?? 0 };
    });
  }

  screenshot(workspaceId: string, sessionId: string, fullPage: boolean) {
    return withBrowserOperation(workspaceId, sessionId, "none", async ({ page }) => {
      const data = await page.screenshot({ type: "png", fullPage, timeout: 15_000 });
      return { contentType: "image/png", data: Buffer.from(data) };
    });
  }

  download(workspaceId: string, sessionId: string, url: string, destinationPath: string) {
    return withBrowserOperation(workspaceId, sessionId, "blank", async (session) => {
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

  upload(workspaceId: string, sessionId: string, selector: string, sourcePath: string) {
    return withBrowserOperation(workspaceId, sessionId, "reload", async (session) => {
      const root = await realpath(session.downloadDirectory).catch(() => "");
      const source = await realpath(sourcePath).catch(() => "");
      if (!root || !source.startsWith(`${root}${path.sep}`)) {
        throw new WorkspaceError("Uploads may only use files created by this browser session.", "path_escape");
      }
      await session.page.locator(selector).setInputFiles(source);
    });
  }

  getCookies(workspaceId: string, sessionId: string) {
    return withBrowserOperation(workspaceId, sessionId, "none", async ({ context }) => {
      const cookies = await context.cookies();
      return cookies.map(({ name, domain, path: cookiePath, expires }) => ({
        name,
        domain,
        path: cookiePath,
        expires: expires < 0 ? null : expires,
      }));
    });
  }

  async runWorkflow(workspaceId: string, sessionId: string, actions: BrowserWorkflow) {
    if (!browserEndpoint && !workflowProxy) {
      throw unavailable("Browser workflows require the deployment's isolated browser egress proxy.");
    }
    return withBrowserOperation(workspaceId, sessionId, "reload", (session) => runBrowserWorkflow(session.page, actions));
  }

  closeSession(workspaceId: string, sessionId: string) {
    return exclusively(workspaceId, async () => {
      const live = getLiveSession(workspaceId);
      const session = live ?? await readBrowserCheckpoint(workspaceId);
      if (session?.sessionId !== sessionId) throw missingSession();
      await deleteBrowserCheckpoint(workspaceId);
      state.sessionsByWorkspace.delete(workspaceId);
      await live?.context.close();
      const workspaceDownloads = path.join(DOWNLOAD_ROOT, createHash("sha256").update(workspaceId).digest("hex"));
      await rm(workspaceDownloads, { recursive: true, force: true });
    });
  }
}

export const playwrightBrowserProvider: WorkspaceBrowserProvider = new PlaywrightBrowserProvider();
