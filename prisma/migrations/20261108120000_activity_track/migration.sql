-- AlterTable
ALTER TABLE "Activity" ADD COLUMN "trackV" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN "hideMapEnds" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "ActivityTrack" (
    "activityId" TEXT NOT NULL PRIMARY KEY,
    "v" INTEGER NOT NULL,
    "polyline" TEXT NOT NULL,
    "distM" TEXT NOT NULL,
    "pointCount" INTEGER NOT NULL,
    "minLat" REAL NOT NULL,
    "minLng" REAL NOT NULL,
    "maxLat" REAL NOT NULL,
    "maxLng" REAL NOT NULL,
    "toleranceM" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ActivityTrack_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
