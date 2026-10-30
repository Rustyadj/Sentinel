-- Additive only: a nullable column, no backfill. NULL means "never revoked",
-- so every mobile token issued before this release stays valid until it expires.
-- AlterTable
ALTER TABLE "users" ADD COLUMN "mobileTokensRevokedAt" TIMESTAMP(3);
