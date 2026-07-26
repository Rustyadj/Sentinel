# Workflow discovery and health

The discovery service examines successful experiences from the last 90 days,
normalizes variable numeric/identifier fields, groups repeated tool/action
sequences, and proposes only groups meeting the configured repetition threshold
(default three). Proposals record human owner, agent operator, tools,
credentials, scopes, approval points, verification, estimates when complete
source metrics exist, failure behavior, rollback, and source runs.

Proposals are never installed automatically. Recurring workflow health is built
from `WorkflowRun` and nullable workflow rollups. Missing runtime, cost,
credential, tool, or schedule data is displayed as unavailable, not guessed.
