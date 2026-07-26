import { requireRedis } from "@/lib/redis";
import { assertInputSize, redactSecrets } from "./security";

export interface WorkingMemoryScope {
  runId: string;
  conversationId?: string;
  agentId: string;
  userId: string;
  organizationId?: string;
  workspaceId?: string;
  projectId?: string;
}

export interface WorkingMemoryEntry {
  key: string;
  value: unknown;
  capturedAt: string;
  scope: WorkingMemoryScope;
}

const safePart = (value?: string) => (value ?? "-").replace(/[^a-zA-Z0-9_-]/g, "_");
export function workingMemoryKey(scope: WorkingMemoryScope) {
  return ["sentinel", "working", safePart(scope.organizationId), safePart(scope.workspaceId),
    safePart(scope.projectId), safePart(scope.userId), safePart(scope.agentId), safePart(scope.conversationId), safePart(scope.runId)].join(":");
}

export async function putWorkingMemory(scope: WorkingMemoryScope, key: string, value: unknown, ttlSeconds = 3600) {
  if (ttlSeconds < 60 || ttlSeconds > 86_400) throw new Error("Working memory TTL must be between 60 and 86400 seconds.");
  const payload: WorkingMemoryEntry = { key, value: redactSecrets(value), capturedAt: new Date().toISOString(), scope };
  const serialized = JSON.stringify(payload);
  assertInputSize(serialized, 256_000);
  const redis = await requireRedis();
  await redis.hset(workingMemoryKey(scope), key, serialized);
  await redis.expire(workingMemoryKey(scope), ttlSeconds);
  return payload;
}

export async function getWorkingMemory(scope: WorkingMemoryScope, key?: string) {
  const redis = await requireRedis();
  const redisKey = workingMemoryKey(scope);
  if (key) {
    const value = await redis.hget(redisKey, key);
    return value ? JSON.parse(value) as WorkingMemoryEntry : null;
  }
  const values = await redis.hvals(redisKey);
  return values.map((value) => JSON.parse(value) as WorkingMemoryEntry);
}

export async function clearWorkingMemory(scope: WorkingMemoryScope) {
  const redis = await requireRedis();
  return redis.del(workingMemoryKey(scope));
}
