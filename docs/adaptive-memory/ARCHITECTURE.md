# Adaptive memory architecture

Sentinel remains the system of record. External agents submit evidence and
candidates; only Sentinel services can promote canonical knowledge.

```text
agent / connector / import / human
        |
        v
admission firewall --> quarantine or review --> canonical graph / typed record
        |                                           |
        v                                           v
working memory (Redis TTL)                 memory index + temporal history
                                                    |
                                                    v
                                    hybrid retrieval + durable trace
                                                    |
                                                    v
                                      frozen active-memory snapshot
                                                    |
                                                    v
                                  experience -> evaluation -> reflection
                                                    |
                                                    v
                                   skill/workflow candidate + replay
```

Functional: admission, Redis working-memory abstraction, immutable run
snapshots, progressive memory index, trace-persisted retrieval, deterministic
source ingestion, reflection triggers, consolidation proposals, skill replay
and version promotion, workflow discovery/health records, delegation, trust
ladder, secret-reference gateway, MCP Streamable HTTP, stdio bridge, governance
APIs, and live review UI.

External scheduler and connector workers are deployment responsibilities. They
call the same services and never gain a direct canonical write path.
