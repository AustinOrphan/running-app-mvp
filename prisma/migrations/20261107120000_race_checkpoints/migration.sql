-- CreateTable
CREATE TABLE "RaceCheckpoint" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "distanceM" INTEGER NOT NULL,
    "gainM" INTEGER,
    "lossM" INTEGER,
    "cutoffSec" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RaceCheckpoint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RaceCheckpoint_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "RaceCheckpoint_userId_idx" ON "RaceCheckpoint"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RaceCheckpoint_goalId_distanceM_key" ON "RaceCheckpoint"("goalId", "distanceM");
