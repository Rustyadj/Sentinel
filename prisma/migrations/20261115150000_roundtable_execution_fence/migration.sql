ALTER TABLE "discussions" ADD COLUMN "executionId" TEXT;
UPDATE "discussions" SET "executionId" = gen_random_uuid()::text;
ALTER TABLE "discussions" ALTER COLUMN "executionId" SET NOT NULL;
