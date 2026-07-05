-- CreateTable
CREATE TABLE "knowledge_objects" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'project',
    "workspaceId" TEXT,
    "projectId" TEXT,
    "organizationId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_edges" (
    "id" TEXT NOT NULL,
    "fromObjectId" TEXT NOT NULL,
    "toObjectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_edges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "decisions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "rationale" TEXT,
    "alternatives" JSONB NOT NULL DEFAULT '[]',
    "sourceLinks" JSONB NOT NULL DEFAULT '[]',
    "approvalHistory" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "supersedesDecisionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artifacts" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "content" TEXT,
    "storageUrl" TEXT,
    "mimeType" TEXT,
    "projectId" TEXT,
    "createdBy" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entities" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" TEXT[],
    "description" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_events" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "roomId" TEXT,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_events_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_fromObjectId_fkey" FOREIGN KEY ("fromObjectId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_edges" ADD CONSTRAINT "knowledge_edges_toObjectId_fkey" FOREIGN KEY ("toObjectId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_supersedesDecisionId_fkey" FOREIGN KEY ("supersedesDecisionId") REFERENCES "decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "knowledge_edges_from_object_id_type_idx" ON "knowledge_edges"("fromObjectId", "type");

-- CreateIndex
CREATE INDEX "knowledge_edges_to_object_id_type_idx" ON "knowledge_edges"("toObjectId", "type");

-- CreateIndex
CREATE INDEX "knowledge_objects_source_type_source_id_idx" ON "knowledge_objects"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "knowledge_objects_scope_idx" ON "knowledge_objects"("scope");

-- CreateIndex
CREATE INDEX "knowledge_objects_project_id_idx" ON "knowledge_objects"("projectId");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "knowledge_edges_from_object_id_to_object_id_type_key" ON "knowledge_edges"("fromObjectId", "toObjectId", "type");

-- CreateUniqueIndex
CREATE UNIQUE INDEX "entities_name_type_key" ON "entities"("name", "type");
