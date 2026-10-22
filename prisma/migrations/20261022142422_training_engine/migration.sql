-- CreateTable
CREATE TABLE "PlanSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "distanceM" INTEGER,
    "gainM" INTEGER,
    "structure" TEXT NOT NULL DEFAULT '[]',
    "target" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "rules" TEXT NOT NULL DEFAULT '[]',
    "flags" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'planned',
    "activityId" TEXT,
    "linkSource" TEXT,
    "execution" TEXT,
    "original" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlanSession_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlanSession_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlanRevision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "changes" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "PlanRevision_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PredictionLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT NOT NULL,
    "predictedSec" INTEGER NOT NULL,
    "lowSec" INTEGER NOT NULL,
    "highSec" INTEGER NOT NULL,
    "inputs" TEXT NOT NULL DEFAULT '{}',
    "actualSec" INTEGER,
    CONSTRAINT "PredictionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PredictionLog_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Screening" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "answers" TEXT NOT NULL,
    "flags" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Screening_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'target',
    "targetDate" TEXT NOT NULL,
    "dateProvisional" BOOLEAN NOT NULL DEFAULT false,
    "distanceM" INTEGER,
    "location" TEXT,
    "successCriteria" TEXT,
    "notes" TEXT,
    "url" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "gainM" INTEGER,
    "lossM" INTEGER,
    "surface" TEXT NOT NULL DEFAULT 'road',
    "goalType" TEXT NOT NULL DEFAULT 'time',
    "targetTimeSec" INTEGER,
    "startTime" TEXT,
    "raceLat" REAL,
    "raceLng" REAL,
    "supportLevel" TEXT NOT NULL DEFAULT 'aided',
    CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Goal" ("createdAt", "dateProvisional", "distanceM", "id", "isActive", "location", "name", "notes", "priority", "status", "successCriteria", "targetDate", "updatedAt", "url", "userId") SELECT "createdAt", "dateProvisional", "distanceM", "id", "isActive", "location", "name", "notes", "priority", "status", "successCriteria", "targetDate", "updatedAt", "url", "userId" FROM "Goal";
DROP TABLE "Goal";
ALTER TABLE "new_Goal" RENAME TO "Goal";
CREATE INDEX "Goal_userId_idx" ON "Goal"("userId");
CREATE TABLE "new_Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "raceWeekStart" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "generatorVersion" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "paramsVersion" TEXT,
    "feasibility" TEXT,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "checklist" TEXT NOT NULL DEFAULT '[]',
    "options" TEXT NOT NULL DEFAULT '{}',
    CONSTRAINT "Plan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Plan_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Plan" ("createdAt", "generatorVersion", "goalId", "id", "name", "raceWeekStart", "startDate", "status", "updatedAt", "userId") SELECT "createdAt", "generatorVersion", "goalId", "id", "name", "raceWeekStart", "startDate", "status", "updatedAt", "userId" FROM "Plan";
DROP TABLE "Plan";
ALTER TABLE "new_Plan" RENAME TO "Plan";
CREATE INDEX "Plan_userId_status_idx" ON "Plan"("userId", "status");
CREATE TABLE "new_PlanWeek" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "phase" TEXT NOT NULL,
    "focus" TEXT,
    "baselineRunMin" INTEGER NOT NULL,
    "targetRunMin" INTEGER NOT NULL,
    "targetSource" TEXT NOT NULL DEFAULT 'baseline',
    "longRunMin" INTEGER NOT NULL,
    "day2Min" INTEGER,
    "runDays" INTEGER NOT NULL,
    "strengthSessions" INTEGER NOT NULL,
    "overrideNote" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "tid" TEXT,
    "flags" TEXT NOT NULL DEFAULT '[]',
    "gainTargetM" INTEGER,
    CONSTRAINT "PlanWeek_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlanWeek" ("baselineRunMin", "day2Min", "focus", "id", "index", "longRunMin", "overrideNote", "phase", "planId", "runDays", "strengthSessions", "targetRunMin", "targetSource", "updatedAt", "weekStart") SELECT "baselineRunMin", "day2Min", "focus", "id", "index", "longRunMin", "overrideNote", "phase", "planId", "runDays", "strengthSessions", "targetRunMin", "targetSource", "updatedAt", "weekStart" FROM "PlanWeek";
DROP TABLE "PlanWeek";
ALTER TABLE "new_PlanWeek" RENAME TO "PlanWeek";
CREATE UNIQUE INDEX "PlanWeek_planId_weekStart_key" ON "PlanWeek"("planId", "weekStart");
CREATE TABLE "new_WellnessDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "restingHr" INTEGER,
    "hrvRmssd" REAL,
    "hrvSdnn" REAL,
    "sleepSec" INTEGER,
    "sleepScore" INTEGER,
    "weightKg" REAL,
    "vo2max" REAL,
    "notes" TEXT,
    "source" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "fatigue" INTEGER,
    "soreness" INTEGER,
    "sleepQuality" INTEGER,
    "mood" INTEGER,
    "stress" INTEGER,
    "illness" BOOLEAN NOT NULL DEFAULT false,
    "painScore" INTEGER,
    "painArea" TEXT,
    "painFocalBone" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WellnessDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WellnessDay" ("date", "hrvRmssd", "hrvSdnn", "id", "notes", "restingHr", "sleepScore", "sleepSec", "source", "updatedAt", "userId", "vo2max", "weightKg") SELECT "date", "hrvRmssd", "hrvSdnn", "id", "notes", "restingHr", "sleepScore", "sleepSec", "source", "updatedAt", "userId", "vo2max", "weightKg" FROM "WellnessDay";
DROP TABLE "WellnessDay";
ALTER TABLE "new_WellnessDay" RENAME TO "WellnessDay";
CREATE UNIQUE INDEX "WellnessDay_userId_date_key" ON "WellnessDay"("userId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PlanSession_activityId_key" ON "PlanSession"("activityId");

-- CreateIndex
CREATE INDEX "PlanSession_planId_date_idx" ON "PlanSession"("planId", "date");

-- CreateIndex
CREATE INDEX "PlanRevision_planId_createdAt_idx" ON "PlanRevision"("planId", "createdAt");

-- CreateIndex
CREATE INDEX "PredictionLog_userId_goalId_createdAt_idx" ON "PredictionLog"("userId", "goalId", "createdAt");

-- CreateIndex
CREATE INDEX "Screening_userId_kind_date_idx" ON "Screening"("userId", "kind", "date");
