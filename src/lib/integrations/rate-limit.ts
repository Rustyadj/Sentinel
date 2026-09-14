import { redisIncrementWithExpiry } from "@/lib/redis";

export async function enforceMcpRateLimit(clientId: string, userId: string): Promise<void> {
  const windowSeconds = 60;
  const maxRequests = Number(process.env.MCP_RATE_LIMIT_PER_MINUTE ?? "60");
  const window = Math.floor(Date.now() / (windowSeconds * 1_000));
  const count = await redisIncrementWithExpiry(`mcp:rate:${clientId}:${userId}:${window}`, windowSeconds + 1);
  if (count === null) throw new Error("MCP rate limiter is unavailable.");
  if (count > maxRequests) throw new Error("MCP rate limit exceeded.");
}
