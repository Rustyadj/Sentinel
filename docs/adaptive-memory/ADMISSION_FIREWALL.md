# Admission firewall

All untrusted durable proposals use `MemoryCandidate`. The service binds human
sources to the authenticated actor, verifies tenant consistency, clamps scores,
requires complete provenance, scans content, decides quarantine/review/rapid
promotion, persists the decision, and emits both adaptive and audit events.

Low-risk explicit user statements and human corrections may rapidly promote at
source trust >= 0.85 and confidence >= 0.80. External sources remain pending
evidence. Unsupported agent inferences, policy override text, embedded tool
directives, credential requests, hidden instructions, privilege escalation, and
self-promotion attempts are quarantined. Operational/security/legal/financial
or permission-bearing content always requires a human.

Quarantined content requires a reviewer note. Agents cannot approve their own
candidates. Rollback closes the canonical object's validity window; it does not
delete history.
