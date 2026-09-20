-- Distinguish "this memory was retrieved" from "this memory was injected into
-- the prompt the worker actually received".
--
-- Orchestration runs retrieved memory and wrote memory_retrievals rows, but
-- the executor dispatched the raw task string, so nothing was ever injected.
-- The reconsolidation service then resolved those rows against run outcomes,
-- recording memories the agent never read as having contributed to success.
-- Without this column that evidence cannot be told apart from the real kind.
--
-- Backfill note: existing rows are left at the default `false`. They are not
-- retroactively marked injected, because for the orchestration path they
-- demonstrably were not, and for the chat path we cannot now prove per-row
-- which ones made the context budget. Leaving them false means they stop
-- counting as evidence rather than counting as the wrong evidence.

ALTER TABLE "memory_retrievals"
  ADD COLUMN "injected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "injectedRank" INTEGER,
  ADD COLUMN "contextTokens" INTEGER,
  ADD COLUMN "consumer" TEXT;

CREATE INDEX "memory_retrievals_injected_idx" ON "memory_retrievals"("injected");
CREATE INDEX "memory_retrievals_consumer_idx" ON "memory_retrievals"("consumer");
