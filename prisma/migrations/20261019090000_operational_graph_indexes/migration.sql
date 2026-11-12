-- Additive indexes only. Existing graph identities, data and constraints remain intact.
-- PostgreSQL takes a write-blocking lock while building these indexes: apply in a maintenance window.
CREATE INDEX "knowledge_objects_workspaceId_type_validTo_idx" ON "knowledge_objects"("workspaceId", "type", "validTo");
CREATE INDEX "knowledge_events_workspaceId_type_createdAt_idx" ON "knowledge_events"("workspaceId", "type", "createdAt");
