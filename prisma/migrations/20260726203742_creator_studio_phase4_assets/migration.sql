-- CreateTable
CREATE TABLE "creator_studio_assets" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "tags" TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_studio_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "creator_studio_assets_brandId_category_idx" ON "creator_studio_assets"("brandId", "category");

-- AddForeignKey
ALTER TABLE "creator_studio_assets" ADD CONSTRAINT "creator_studio_assets_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "creator_studio_brands"("id") ON DELETE CASCADE ON UPDATE CASCADE;
