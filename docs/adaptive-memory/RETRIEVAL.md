# Retrieval and Recall Trace

The `adaptive-hybrid-v1` score is a bounded weighted sum:

```text
0.22 semantic + 0.18 keyword + 0.08 graph + 0.12 scope
+ 0.07 recency + 0.08 importance + 0.08 confidence + 0.08 source trust
+ 0.04 historical success + 0.03 agent preference
- 0.12 contradiction - 0.08 staleness
```

Tenant scope is applied before ranking. Only current canonical
`KnowledgeObject` rows are considered; pending/quarantined candidates cannot
leak into prompts. Selection stops at both item and token budgets. Each trace
stores all factor scores, rank, inclusion/exclusion reason, token cost, prompt
appearance, and later output-influence status.

Semantic scores are accepted from an authorized embedding provider. When none
is configured the semantic factor is honestly zero; lexical and graph signals
continue to work. The built-in memory index supports topic-first progressive
disclosure instead of whole-document prompt injection.
