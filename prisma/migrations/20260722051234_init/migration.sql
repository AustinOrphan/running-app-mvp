-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "distance" REAL NOT NULL,
    "duration" INTEGER NOT NULL,
    "tag" TEXT,
    "notes" TEXT,
    "routeGeoJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Run_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "targetValue" REAL NOT NULL,
    "targetUnit" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "currentValue" REAL NOT NULL DEFAULT 0,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" DATETIME,
    "color" TEXT,
    "icon" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Race" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "raceDate" DATETIME NOT NULL,
    "distance" REAL NOT NULL,
    "targetTime" INTEGER,
    "actualTime" INTEGER,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Race_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Run_userId_idx" ON "Run"("userId");

-- CreateIndex
CREATE INDEX "Run_date_idx" ON "Run"("date");

-- CreateIndex
CREATE UNIQUE INDEX "RunDetail_runId_key" ON "RunDetail"("runId");

-- CreateIndex
CREATE INDEX "RunDetail_runId_idx" ON "RunDetail"("runId");

-- CreateIndex
CREATE INDEX "Goal_userId_idx" ON "Goal"("userId");

-- CreateIndex
CREATE INDEX "Goal_type_idx" ON "Goal"("type");

-- CreateIndex
CREATE INDEX "Goal_period_idx" ON "Goal"("period");

-- CreateIndex
CREATE INDEX "Goal_isActive_idx" ON "Goal"("isActive");

-- CreateIndex
CREATE INDEX "Race_userId_idx" ON "Race"("userId");

-- CreateIndex
CREATE INDEX "Race_raceDate_idx" ON "Race"("raceDate");

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
CREATE UNIQUE INDEX "LocationHeatmap_userId_gridSize_key" ON "LocationHeatmap"("userId", "gridSize");

-- CreateIndex
CREATE UNIQUE INDEX "RunTendency_userId_key" ON "RunTendency"("userId");

-- CreateIndex
CREATE INDEX "RunTendency_userId_idx" ON "RunTendency"("userId");
