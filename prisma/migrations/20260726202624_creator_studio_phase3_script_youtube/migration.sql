-- AlterTable
ALTER TABLE "creator_studio_items" ADD COLUMN     "chapters" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "description" TEXT,
ADD COLUMN     "outline" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "creator_studio_hooks" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "style" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_studio_hooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creator_studio_hooks_contentItemId_idx" ON "creator_studio_hooks"("contentItemId");

-- AddForeignKey
ALTER TABLE "creator_studio_hooks" ADD CONSTRAINT "creator_studio_hooks_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "creator_studio_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
