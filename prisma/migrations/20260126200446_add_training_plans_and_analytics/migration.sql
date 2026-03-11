-- CreateTable
CREATE TABLE "RunDetail" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "heartRate" INTEGER,
    "avgHeartRate" INTEGER,
    "maxHeartRate" INTEGER,
    "minHeartRate" INTEGER,
    "elevation" REAL,
    "elevationGain" REAL,
    "elevationLoss" REAL,
    "weather" TEXT,
    "temperature" REAL,
    "humidity" REAL,
    "windSpeed" REAL,
    "effortLevel" INTEGER,
    "cadence" INTEGER,
    "avgCadence" INTEGER,
    "splits" TEXT,
    "gpsData" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunDetail_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "goal" TEXT NOT NULL,
    "targetRaceId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "difficulty" TEXT NOT NULL DEFAULT 'intermediate',
    "weeklyMileageStart" REAL,
    "weeklyMileageTarget" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrainingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrainingPlan_targetRaceId_fkey" FOREIGN KEY ("targetRaceId") REFERENCES "Race" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkoutTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trainingPlanId" TEXT NOT NULL,
    "weekNumber" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetDistance" REAL,
    "targetDuration" INTEGER,
    "targetPace" REAL,
    "intensity" TEXT,
    "notes" TEXT,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkoutTemplate_trainingPlanId_fkey" FOREIGN KEY ("trainingPlanId") REFERENCES "TrainingPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkoutTemplate_completedRunId_fkey" FOREIGN KEY ("completedRunId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunAnalytics" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "totalRuns" INTEGER NOT NULL DEFAULT 0,
    "totalDistance" REAL NOT NULL DEFAULT 0,
    "totalDuration" INTEGER NOT NULL DEFAULT 0,
    "avgPace" REAL,
    "avgDistance" REAL,
    "avgHeartRate" INTEGER,
    "totalElevationGain" REAL,
    "caloriesBurned" INTEGER,
    "trends" TEXT,
    "insights" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunAnalytics_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LocationHeatmap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "lastVisited" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalDistance" REAL NOT NULL DEFAULT 0,
    "avgPace" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LocationHeatmap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RunTendency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "lastCalculated" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RunTendency_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "RunDetail_runId_key" ON "RunDetail"("runId");

-- CreateIndex
CREATE INDEX "RunDetail_runId_idx" ON "RunDetail"("runId");

-- CreateIndex
CREATE INDEX "TrainingPlan_userId_idx" ON "TrainingPlan"("userId");

-- CreateIndex
CREATE INDEX "TrainingPlan_isActive_idx" ON "TrainingPlan"("isActive");

-- CreateIndex
CREATE INDEX "WorkoutTemplate_trainingPlanId_idx" ON "WorkoutTemplate"("trainingPlanId");

-- CreateIndex
CREATE INDEX "WorkoutTemplate_weekNumber_idx" ON "WorkoutTemplate"("weekNumber");

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
CREATE INDEX "LocationHeatmap_latitude_longitude_idx" ON "LocationHeatmap"("latitude", "longitude");

-- CreateIndex
CREATE UNIQUE INDEX "LocationHeatmap_userId_latitude_longitude_key" ON "LocationHeatmap"("userId", "latitude", "longitude");

-- CreateIndex
CREATE INDEX "RunTendency_userId_idx" ON "RunTendency"("userId");

-- CreateIndex
CREATE INDEX "RunTendency_type_idx" ON "RunTendency"("type");
