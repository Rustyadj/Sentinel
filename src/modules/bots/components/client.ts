// Thin client for /api/bots. Errors carry the server's message so screens can
// show what actually failed and keep the user's input.

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); this.name = "ApiError"; }
}

export async function api<T = unknown>(url: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: init?.body !== undefined ? { "content-type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(typeof data?.error === "string" ? data.error : `Request failed (${response.status})`, response.status);
  return data as T;
}

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong");

export const TERMINAL = ["COMPLETED", "FAILED", "CANCELLED"];

export const MEMORY_SCOPE_LABEL: Record<string, string> = {
  bot: "This bot only", session: "Session", project: "Project", workspace: "Workspace", organization: "Organization", user: "User", global: "Global",
};
