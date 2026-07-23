# Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | PostgreSQL with pgvector. |
| `REDIS_URL` | for working memory | Redis connection. Working memory is unavailable without it. |
| `MCP_CREDENTIAL_PEPPER` | production MCP | Server-only pepper for stored MCP credential hashes. |
| `MCP_MAX_BODY_BYTES` | no | MCP input limit; default 1,000,000. |
| `ACTIVE_MEMORY_MAX_TOKENS` | no | Frozen card limit; clamped to 600-1,600. |
| `REFLECTION_COST_THRESHOLD` | no | Significant-run cost threshold; default 2. |
| `REFLECTION_RUNTIME_THRESHOLD_MS` | no | Significant-run runtime threshold; default 120,000. |
| `DELEGATION_MAX_RUNTIME_MS` | no | Hard delegated runtime cap; default 3,600,000. |
| `DELEGATION_MAX_COST` | no | Hard delegated cost cap; default 25. |
| `SENTINEL_MCP_URL` | stdio only | Remote `/mcp` URL. |
| `SENTINEL_MCP_CREDENTIAL` | stdio only | Short-lived client credential; never expose to a model. |

Secret values must be stored in the deployment secret manager, not committed.
