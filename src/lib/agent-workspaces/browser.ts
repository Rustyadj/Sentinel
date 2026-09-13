// Server-side only. The `server-only` marker package is deliberately not used:
// it is unresolvable outside the Next bundler, which breaks the Node entry
// points that legitimately drive workspaces (the acceptance script, cron and
// worker processes). These modules import Node built-ins, so a client import
// fails loudly on its own.
import { WorkspaceError } from "./errors";
import { playwrightBrowserProvider } from "./providers/browser-playwright";

export interface BrowserSession {
  sessionId: string;
  workspaceId: string;
  startedAt: string;
  currentUrl: string | null;
}

export interface BrowserRuntimeStatus {
  attached: boolean;
  provider: string | null;
  reason?: string;
}

export interface WorkspaceBrowserProvider {
  readonly id: string;
  runtimeStatus(): BrowserRuntimeStatus;
  createSession(workspaceId: string): Promise<BrowserSession>;
  getSession(sessionId: string): BrowserSession | null;
  navigate(sessionId: string, url: string): Promise<{ url: string; status: number }>;
  screenshot(sessionId: string, fullPage: boolean): Promise<{ contentType: string; data: Buffer }>;
  download(sessionId: string, url: string, destinationPath: string): Promise<{ path: string; sizeBytes: number }>;
  upload(sessionId: string, selector: string, sourcePath: string): Promise<void>;
  getCookies(sessionId: string): Promise<{ name: string; domain: string; path: string; expires: number | null }[]>;
  closeSession(sessionId: string): Promise<void>;
}

let provider: WorkspaceBrowserProvider | null = null;

export function registerBrowserProvider(next: WorkspaceBrowserProvider) {
  provider = next;
}

// This module is server-only. Importing the browser seam registers the real
// provider, whose status remains unattached until its Chromium launch probe
// has succeeded.
registerBrowserProvider(playwrightBrowserProvider);

export function getBrowserProvider(): WorkspaceBrowserProvider {
  if (!provider) {
    throw new WorkspaceError(
      "No browser runtime is attached to this Sentinel deployment yet.",
      "not_implemented",
    );
  }
  return provider;
}

export function browserRuntimeStatus(): BrowserRuntimeStatus {
  return provider?.runtimeStatus() ?? {
    attached: false,
    provider: null,
    reason: "No browser provider registered.",
  };
}
