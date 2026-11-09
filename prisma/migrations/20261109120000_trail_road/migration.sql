-- AlterTable
ALTER TABLE "Activity" ADD COLUMN "surfaceBins" TEXT;

-- CreateTable
CREATE TABLE "MapArea" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "minLat" REAL NOT NULL,
    "minLng" REAL NOT NULL,
    "maxLat" REAL NOT NULL,
    "maxLng" REAL NOT NULL,
    "fetchedAt" DATETIME NOT NULL,
    "dataTimestamp" TEXT,
    "wayCount" INTEGER NOT NULL,
    "v" INTEGER NOT NULL,
    "matchV" INTEGER NOT NULL,
    CONSTRAINT "MapArea_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MapWay" (
    "userId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "cls" TEXT NOT NULL,
    "polyline" TEXT NOT NULL,

    PRIMARY KEY ("userId", "seq"),
    CONSTRAINT "MapWay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

