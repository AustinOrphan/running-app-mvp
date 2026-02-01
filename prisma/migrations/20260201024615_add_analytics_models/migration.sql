-- CreateTable
CREATE TABLE "RunDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "avgHeartRate" INTEGER,
    "maxHeartRate" INTEGER,
    "hrZoneDistribution" TEXT,
    "routeGeoJson" TEXT,
    "elevationGain" REAL,
    "elevationLoss" REAL,
    "elevationProfile" TEXT,
    "temperature" REAL,
    "humidity" REAL,
    "windSpeed" REAL,
    "weatherCondition" TEXT,
    "avgCadence" INTEGER,
    "maxCadence" INTEGER,
    "strideLength" REAL,
    "verticalOscillation" REAL,
    "groundContactTime" INTEGER,
    "trainingLoad" REAL,
    "perceivedEffort" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunDetail_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunAnalytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "totalRuns" INTEGER NOT NULL,
    "totalDistance" REAL NOT NULL,
    "totalDuration" INTEGER NOT NULL,
    "totalElevation" REAL,
    "avgPace" REAL NOT NULL,
    "fastestPace" REAL NOT NULL,
    "longestRun" REAL NOT NULL,
    "avgHeartRate" INTEGER,
    "maxHeartRate" INTEGER,
    "totalTrainingLoad" REAL,
    "avgTrainingLoad" REAL,
    "runsPerWeek" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunAnalytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LocationHeatmap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "gridSize" REAL NOT NULL,
    "heatmapData" TEXT NOT NULL,
    "popularRoutes" TEXT,
    "minLat" REAL NOT NULL,
    "maxLat" REAL NOT NULL,
    "minLng" REAL NOT NULL,
    "maxLng" REAL NOT NULL,
    "totalRuns" INTEGER NOT NULL,
    "lastUpdated" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LocationHeatmap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunTendency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "preferredDaysOfWeek" TEXT NOT NULL,
    "preferredTimeOfDay" TEXT,
    "avgRunsPerWeek" REAL NOT NULL,
    "preferredDistances" TEXT NOT NULL,
    "avgRunDistance" REAL NOT NULL,
    "longestRunEver" REAL NOT NULL,
    "avgEasyPace" REAL NOT NULL,
    "avgTempoPace" REAL,
    "avgIntervalPace" REAL,
    "homeBaseLocation" TEXT,
    "explorationScore" REAL,
    "currentStreak" INTEGER NOT NULL,
    "longestStreak" INTEGER NOT NULL,
    "avgRestDaysBetween" REAL NOT NULL,
    "lastAnalyzed" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunTendency_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RunDetail_runId_key" ON "RunDetail"("runId");

-- CreateIndex
CREATE INDEX "RunDetail_runId_idx" ON "RunDetail"("runId");

-- CreateIndex
CREATE INDEX "RunAnalytics_userId_idx" ON "RunAnalytics"("userId");

-- CreateIndex
CREATE INDEX "RunAnalytics_period_idx" ON "RunAnalytics"("period");

-- CreateIndex
CREATE INDEX "RunAnalytics_startDate_idx" ON "RunAnalytics"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "RunAnalytics_userId_period_startDate_key" ON "RunAnalytics"("userId", "period", "startDate");

-- CreateIndex
CREATE INDEX "LocationHeatmap_userId_idx" ON "LocationHeatmap"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationHeatmap_userId_gridSize_key" ON "LocationHeatmap"("userId", "gridSize");

-- CreateIndex
CREATE UNIQUE INDEX "RunTendency_userId_key" ON "RunTendency"("userId");

-- CreateIndex
CREATE INDEX "RunTendency_userId_idx" ON "RunTendency"("userId");
