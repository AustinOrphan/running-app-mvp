-- CreateTable
CREATE TABLE "StrengthSettings" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "equipment" TEXT NOT NULL DEFAULT '[]',
    "level" TEXT NOT NULL DEFAULT 'new',
    "currentlyLifting" BOOLEAN NOT NULL DEFAULT false,
    "avoid" TEXT NOT NULL DEFAULT '[]',
    "pinned" TEXT NOT NULL DEFAULT '{}',
    "note" TEXT,
    "savedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrengthSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StrengthLift" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "loadG" INTEGER NOT NULL,
    "reps" INTEGER NOT NULL,
    "rir" INTEGER,
    "asOf" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrengthLift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StrengthLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "prescribed" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StrengthLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrengthLog_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StrengthSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "logId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "exerciseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "loadG" INTEGER,
    "count" INTEGER NOT NULL,
    "rir" INTEGER,
    CONSTRAINT "StrengthSet_logId_fkey" FOREIGN KEY ("logId") REFERENCES "StrengthLog" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StrengthSet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "units" TEXT NOT NULL DEFAULT 'mi',
    "weightUnit" TEXT NOT NULL DEFAULT 'lb',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
-- A runner who reads distances in kilometres reads loads in kilograms; every other runner, pounds.
INSERT INTO "new_User" ("createdAt", "displayName", "email", "id", "passwordHash", "units", "updatedAt", "weightUnit") SELECT "createdAt", "displayName", "email", "id", "passwordHash", "units", "updatedAt", CASE WHEN "units" = 'km' THEN 'kg' ELSE 'lb' END FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "StrengthLift_userId_exerciseId_key" ON "StrengthLift"("userId", "exerciseId");

-- CreateIndex
CREATE UNIQUE INDEX "StrengthLog_activityId_key" ON "StrengthLog"("activityId");

-- CreateIndex
CREATE INDEX "StrengthLog_userId_idx" ON "StrengthLog"("userId");

-- CreateIndex
CREATE INDEX "StrengthSet_logId_position_idx" ON "StrengthSet"("logId", "position");

-- CreateIndex
CREATE INDEX "StrengthSet_userId_exerciseId_idx" ON "StrengthSet"("userId", "exerciseId");

