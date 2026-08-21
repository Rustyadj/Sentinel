-- AlterTable
ALTER TABLE "chat_rooms" ADD COLUMN     "isPrimary" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: flag each user's oldest room as their primary "Mission Control"
-- room, so pre-existing accounts get the same primary/direct distinction as
-- new ones instead of every room defaulting to isPrimary=false forever.
UPDATE "chat_rooms" AS c
SET "isPrimary" = true
WHERE c."userId" IS NOT NULL
  AND c."id" = (
    SELECT c2."id" FROM "chat_rooms" AS c2
    WHERE c2."userId" = c."userId"
    ORDER BY c2."createdAt" ASC, c2."id" ASC
    LIMIT 1
  );
