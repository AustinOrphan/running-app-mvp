-- AlterTable
ALTER TABLE "PlanSession" ADD COLUMN "refusedActivityIds" TEXT;

-- An unlink used to mark the session itself ('owner' with no activity), which kept the matcher
-- away from it for every activity. The mark now names the refused activities instead (a JSON
-- array). The activity of an old mark is unknown, so the session refuses every activity of the
-- same runner dated within one day of it, which holds the run that was unlinked; the session is
-- free for any later activity. This over-refuses within that window by design.
UPDATE "PlanSession"
SET "refusedActivityIds" = (
      SELECT json_group_array(a."id")
      FROM "Activity" a
      WHERE a."userId" = (
              SELECT p."userId" FROM "Plan" p WHERE p."id" = "PlanSession"."planId"
            )
        AND a."date" >= date("PlanSession"."date", '-1 day')
        AND a."date" <= date("PlanSession"."date", '+1 day')
    ),
    "linkSource" = NULL
WHERE "linkSource" = 'owner' AND "activityId" IS NULL;

-- A mark with no activity near it refuses nothing: an empty array reads as none.
UPDATE "PlanSession" SET "refusedActivityIds" = NULL WHERE "refusedActivityIds" = '[]';
