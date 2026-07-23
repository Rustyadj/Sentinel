# Security model

- Authenticated server identity is authoritative; client IDs are filters only.
- Workspace/project RBAC is checked before reads and writes.
- Personal memory rejects cross-user access.
- Candidates are scanned and quarantined before canonical promotion.
- MCP adds scopes, tenant binding, origin validation, expiry/revocation, rate
  limits, trust policy, cost ceilings, cancellation, replay protection, and
  mutation idempotency.
- Level 4 always requires explicit human approval and is not provisionable to an
  MCP client.
- Credentials remain external encrypted references. Execution handlers receive
  values only inside a function, and persisted/request output is redacted.
- Input/token/body limits bound memory, ingestion, retrieval, and MCP requests.
- Every governed mutation writes audit or structured adaptive events.

Known limitation: legacy `Contradiction` rows lack tenant fields. The new UI/API
fails closed for contradiction review until those rows are backfilled safely.
