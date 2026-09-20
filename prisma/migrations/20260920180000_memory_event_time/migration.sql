-- When the thing a memory describes actually happened.
--
-- Episodic ordering was measured at 0.000 and the reason is that there was
-- nothing correct to order by. Memory carries three timestamps and none of
-- them is event time:
--
--   createdAt  -- when the row was inserted. A rollout recalled a week later
--               inserts in the order it was recalled, not the order it happened.
--   validFrom  -- when the belief became valid. Right for a fact, wrong for an
--               event: an incident that happened in March and was recorded in
--               September was not "valid from September".
--   updatedAt  -- unrelated.
--
-- So "what happened first?" was being answered from insertion order, which is
-- correct only by coincidence.
--
-- Additive: one nullable column and one index. Nullable because most memories
-- are not episodic and have no event time, and because a null must fall back
-- to validFrom rather than be invented -- a guessed event time is worse than
-- an absent one, since it orders confidently and wrongly.
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "eventTime" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "memories_eventTime_idx" ON "memories"("eventTime");
