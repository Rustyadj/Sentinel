-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "contentProjectId" TEXT;

-- CreateTable
CREATE TABLE "creator_studio_projects" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_studio_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_studio_items" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'video',
    "status" TEXT NOT NULL DEFAULT 'idea',
    "platform" TEXT,
    "content" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "tags" TEXT[],
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_studio_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creator_studio_projects_brandId_idx" ON "creator_studio_projects"("brandId");

-- CreateIndex
CREATE INDEX "creator_studio_items_brandId_status_idx" ON "creator_studio_items"("brandId", "status");

-- CreateIndex
CREATE INDEX "creator_studio_items_projectId_idx" ON "creator_studio_items"("projectId");

-- CreateIndex
CREATE INDEX "tasks_contentProjectId_idx" ON "tasks"("contentProjectId");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_contentProjectId_fkey" FOREIGN KEY ("contentProjectId") REFERENCES "creator_studio_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_studio_projects" ADD CONSTRAINT "creator_studio_projects_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "creator_studio_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_studio_items" ADD CONSTRAINT "creator_studio_items_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "creator_studio_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_studio_items" ADD CONSTRAINT "creator_studio_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "creator_studio_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
