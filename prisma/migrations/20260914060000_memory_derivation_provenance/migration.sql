-- Continual memory, stage 2: the retrieval -> outcome join needs to know which
-- experiences produced a derived memory, so those experiences can be excluded
-- from ever confirming it. Additive only.
ALTER TABLE "memories" ADD COLUMN "derivedFromExperienceIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
