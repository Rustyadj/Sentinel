-- CreateTable
CREATE TABLE "org_charts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Main',
    "nodes" JSONB NOT NULL DEFAULT '[]',
    "edges" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_charts_pkey" PRIMARY KEY ("id")
);
