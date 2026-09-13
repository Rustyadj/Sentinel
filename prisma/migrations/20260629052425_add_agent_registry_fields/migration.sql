-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "description" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "instructionFiles" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "promptHistory" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "skills" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();
