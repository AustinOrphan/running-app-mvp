-- AlterTable
ALTER TABLE "PlanSession" ADD COLUMN "refusedActivityId" TEXT;

-- An unlink used to mark the session itself ('owner' with no activity), which kept the matcher
-- away from it for every activity. The mark now names the refused activity instead. The activity
-- of an old mark is unknown, so those sessions go back to free and refuse nothing.
UPDATE "PlanSession" SET "linkSource" = NULL WHERE "linkSource" = 'owner' AND "activityId" IS NULL;
