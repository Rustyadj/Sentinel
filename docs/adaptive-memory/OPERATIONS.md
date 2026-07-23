# Operations

1. Back up PostgreSQL.
2. Set the variables in `ENVIRONMENT_VARIABLES.md`.
3. Run `npx prisma migrate deploy` once per release.
4. Start PostgreSQL with pgvector, Redis, and the Sentinel application.
5. Terminate TLS at Traefik or the production ingress.
6. Create MCP clients through `/api/mcp/clients`; capture the credential once.
7. Schedule reflection, consolidation, candidate expiry, skill degradation, and
   workflow missed-run checks from an authenticated external scheduler.
8. Monitor `adaptive_events`, `audit_logs`, failed `adaptive_mcp_requests`,
   quarantined candidates, degraded skills, and workflow failures.

If Redis is unavailable, working memory fails explicitly. Durable knowledge and
review queues remain available; do not silently fall back to process memory.
