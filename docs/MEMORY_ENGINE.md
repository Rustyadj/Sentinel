# Memory Engine

Sentinel's memory engine is now governed by the adaptive-memory architecture.
Working state is ephemeral Redis data; experiences preserve trajectories;
trusted semantic and procedural knowledge lives in the existing temporal graph
and typed canonical tables; all untrusted durable writes pass through candidate
admission and review.

See [adaptive-memory/ARCHITECTURE.md](adaptive-memory/ARCHITECTURE.md),
[adaptive-memory/MEMORY_TYPES.md](adaptive-memory/MEMORY_TYPES.md),
[adaptive-memory/ADMISSION_FIREWALL.md](adaptive-memory/ADMISSION_FIREWALL.md),
and [adaptive-memory/RETRIEVAL.md](adaptive-memory/RETRIEVAL.md).

The legacy `/api/memories` surface remains available for compatibility but is
not an authorized write path for agents, imports, connectors, or MCP clients.
