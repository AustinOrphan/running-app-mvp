-- AlterTable
ALTER TABLE "PlanWeek" ADD COLUMN "isRecovery" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlanWeek" ADD COLUMN "qualitySessions" INTEGER NOT NULL DEFAULT 0;

-- Backfill from the stored rows, so the first re-plan after the upgrade reads the values it derived
-- before the columns existed instead of 0.
--
-- qualitySessions: the PlanSession rows of the week whose kind is a quality kind. The kinds are
-- QUALITY_KINDS in shared/engine/readiness.ts (`isQualityKind`): threshold, intervals, hills,
-- race-pace and long-fast-finish. The engine's own count per week was never stored, so a week
-- where it differs from the placed sessions (the race week counts 1 and holds strides, a specific
-- week may count 2 and place 1) gets the engine's count at the first re-plan, which reports it once.
UPDATE "PlanWeek"
SET "qualitySessions" = (
  SELECT COUNT(*)
  FROM "PlanSession"
  WHERE "PlanSession"."planId" = "PlanWeek"."planId"
    AND "PlanSession"."weekStart" = "PlanWeek"."weekStart"
    AND "PlanSession"."kind" IN ('threshold', 'intervals', 'hills', 'race-pace', 'long-fast-finish')
);

-- isRecovery: the engine writes the 'recovery' flag on a recovery week, and a post-race week
-- (shared/engine/postRace.ts) is a recovery week that carries only 'post-race'.
UPDATE "PlanWeek"
SET "isRecovery" = 1
WHERE "flags" LIKE '%"recovery"%' OR "flags" LIKE '%"post-race"%';
