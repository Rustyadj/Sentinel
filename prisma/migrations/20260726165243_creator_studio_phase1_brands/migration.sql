/*
  Warnings:

  - You are about to alter the column `embedding` on the `memories` table. The data in that column could be lost. The data in that column will be cast from `vector(1536)` to `Text`.

*/
-- AlterTable
ALTER TABLE "memories" ALTER COLUMN "embedding" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "creator_studio_brands" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_studio_brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_studio_brand_profiles" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "logoUrl" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#6366F1',
    "secondaryColor" TEXT NOT NULL DEFAULT '#8B5CF6',
    "typography" JSONB NOT NULL DEFAULT '{}',
    "mission" TEXT,
    "targetAudience" TEXT,
    "painPoints" TEXT[],
    "toneOfVoice" TEXT,
    "products" TEXT[],
    "services" TEXT[],
    "competitors" TEXT[],
    "frequentPhrases" TEXT[],
    "wordsToAvoid" TEXT[],
    "ctaPreferences" TEXT,
    "thumbnailStyle" TEXT,
    "videoStyle" TEXT,
    "hookStyle" TEXT,
    "seoKeywords" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_studio_brand_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_studio_ideas" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceUrl" TEXT,
    "tags" TEXT[],
    "knowledgeObjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_studio_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "creator_studio_brands_slug_key" ON "creator_studio_brands"("slug");

-- CreateIndex
CREATE INDEX "creator_studio_brands_ownerId_idx" ON "creator_studio_brands"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "creator_studio_brand_profiles_brandId_key" ON "creator_studio_brand_profiles"("brandId");

-- CreateIndex
CREATE INDEX "creator_studio_ideas_brandId_idx" ON "creator_studio_ideas"("brandId");

-- AddForeignKey
ALTER TABLE "creator_studio_brands" ADD CONSTRAINT "creator_studio_brands_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_studio_brand_profiles" ADD CONSTRAINT "creator_studio_brand_profiles_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "creator_studio_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_studio_ideas" ADD CONSTRAINT "creator_studio_ideas_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "creator_studio_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "knowledge_edges_from_object_id_to_object_id_type_key" RENAME TO "knowledge_edges_fromObjectId_toObjectId_type_key";

-- RenameIndex
ALTER INDEX "knowledge_edges_from_object_id_type_idx" RENAME TO "knowledge_edges_fromObjectId_type_idx";

-- RenameIndex
ALTER INDEX "knowledge_edges_to_object_id_type_idx" RENAME TO "knowledge_edges_toObjectId_type_idx";

-- RenameIndex
ALTER INDEX "knowledge_objects_project_id_idx" RENAME TO "knowledge_objects_projectId_idx";

-- RenameIndex
ALTER INDEX "knowledge_objects_source_type_source_id_idx" RENAME TO "knowledge_objects_sourceType_sourceId_idx";
