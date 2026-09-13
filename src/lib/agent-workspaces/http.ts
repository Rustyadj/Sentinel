import { WorkspaceError } from "./errors";
import type { ActorContext } from "./service";
import type { RuntimeClient } from "./types";

export async function readJson<T extends Record<string, unknown>>(request: Request): Promise<T> {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new WorkspaceError("A JSON object body is required.", "invalid_body");
    }
    return body as T;
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    throw new WorkspaceError("Request body must be valid JSON.", "invalid_body");
  }
}

export function requireString(value: unknown, field: string, maxLength = 1000) {
  if (typeof value !== "string" || !value.trim()) {
    throw new WorkspaceError(`"${field}" is required.`, "invalid_body");
  }
  if (value.length > maxLength) throw new WorkspaceError(`"${field}" is too long.`, "invalid_body");
  return value;
}

export function optionalString(value: unknown, field: string, maxLength = 1000) {
  if (value === undefined || value === null) return undefined;
  return requireString(value, field, maxLength);
}

/**
 * A request that arrives through the Sentinel UI acts as the signed-in human.
 * Requests from execution clients carry their own client id and are authorised
 * by the runtime gateway instead.
 */
export function uiActor(userId: string, client: RuntimeClient = "sentinel-ui"): ActorContext {
  return { userId, agentId: null, client };
}

/** BigInt fields cannot be serialised by JSON.stringify — normalise for the wire. */
export function serialize<T>(value: T): T {
  return JSON.parse(JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item)));
}
