-- AlterTable
ALTER TABLE "creator_studio_items" ADD COLUMN     "sourceItemId" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT;

-- CreateIndex
CREATE INDEX "creator_studio_items_sourceItemId_idx" ON "creator_studio_items"("sourceItemId");

-- AddForeignKey
ALTER TABLE "creator_studio_items" ADD CONSTRAINT "creator_studio_items_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "creator_studio_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
