import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { emitAdaptiveEvent } from "@/lib/adaptive-memory/event-service";

const hashCredential = (credential: string) => createHash("sha256").update(`${process.env.MCP_CREDENTIAL_PEPPER ?? ""}:${credential}`).digest("hex");

export async function createMcpClient(input: {
  name: string; organizationId?: string; workspaceId?: string; projectId?: string;
  userId: string; scopes: string[]; allowedOrigins: string[]; trustLevel?: number;
  rateLimitPerMinute?: number; maxCostPerRequest?: number; expiresAt: Date; createdBy: string;
}) {
  if (process.env.NODE_ENV === "production" && !process.env.MCP_CREDENTIAL_PEPPER) throw new Error("MCP_CREDENTIAL_PEPPER is required in production.");
  if (input.expiresAt <= new Date()) throw new Error("MCP credential expiry must be in the future.");
  if (input.trustLevel === 4) throw new Error("MCP clients cannot be provisioned at trust level 4.");
  const prefix = randomBytes(6).toString("hex");
  const credential = `sentinel_mcp_${prefix}.${randomBytes(32).toString("base64url")}`;
  const client = await db.mcpClient.create({ data: {
    name: input.name, credentialHash: hashCredential(credential), credentialPrefix: prefix,
    organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
    userId: input.userId, scopes: input.scopes, allowedOrigins: input.allowedOrigins,
    trustLevel: input.trustLevel ?? 0, rateLimitPerMinute: input.rateLimitPerMinute ?? 60,
    maxCostPerRequest: input.maxCostPerRequest, expiresAt: input.expiresAt, createdBy: input.createdBy,
  }});
  return { client, credential };
}

export interface McpAuthContext {
  clientId: string; userId: string; organizationId?: string; workspaceId?: string;
  projectId?: string; scopes: string[]; trustLevel: number; maxCostPerRequest?: number;
}

export async function authenticateMcp(request: Request): Promise<McpAuthContext> {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) throw new Error("MCP authentication required.");
  const credential = auth.slice(7);
  const match = credential.match(/^sentinel_mcp_([a-f0-9]{12})\./);
  if (!match) throw new Error("Invalid MCP credential format.");
  const client = await db.mcpClient.findFirst({ where: { credentialPrefix: match[1] } });
  if (!client) throw new Error("Invalid MCP credential.");
  const expected = Buffer.from(client.credentialHash, "hex");
  const actual = Buffer.from(hashCredential(credential), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Invalid MCP credential.");
  if (client.revokedAt || client.expiresAt <= new Date()) throw new Error("MCP credential expired or revoked.");
  if (!client.userId) throw new Error("MCP client has no acting user binding.");
  const origin = request.headers.get("origin");
  if (origin && !client.allowedOrigins.includes(origin)) throw new Error("MCP origin denied.");
  const since = new Date(Date.now() - 60_000);
  const recent = await db.mcpRequest.count({ where: { clientId: client.id, createdAt: { gte: since } } });
  if (recent >= client.rateLimitPerMinute) throw new Error("MCP rate limit exceeded.");
  await db.mcpClient.update({ where: { id: client.id }, data: { lastSeenAt: new Date() } });
  return { clientId: client.id, userId: client.userId, organizationId: client.organizationId ?? undefined,
    workspaceId: client.workspaceId ?? undefined, projectId: client.projectId ?? undefined,
    scopes: client.scopes, trustLevel: client.trustLevel, maxCostPerRequest: client.maxCostPerRequest ?? undefined };
}

export function requireMcpScope(context: McpAuthContext, scope: string) {
  if (!context.scopes.includes("*") && !context.scopes.includes(scope)) throw new Error(`MCP scope denied: ${scope}`);
}

export async function recordMcpDenial(context: Partial<McpAuthContext>, reason: string, toolName?: string) {
  await emitAdaptiveEvent({ type: "mcp.authorization_denied", userId: context.userId,
    workspaceId: context.workspaceId, projectId: context.projectId,
    error: reason, payload: { clientId: context.clientId ?? null, toolName: toolName ?? null } });
}

export function assertClientTenant(context: McpAuthContext, input: Record<string, unknown>) {
  for (const key of ["organizationId", "workspaceId", "projectId"] as const) {
    const bound = context[key];
    const requested = typeof input[key] === "string" ? input[key] : undefined;
    if (bound && requested && bound !== requested) throw new Error(`MCP ${key} isolation denied.`);
    if (bound && !requested) input[key] = bound;
  }
}
