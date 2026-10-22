-- AlterTable
ALTER TABLE "Activity" ADD COLUMN "avgCadence" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "avgPowerW" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "decouplingPct" REAL;
ALTER TABLE "Activity" ADD COLUMN "deviceName" TEXT;
ALTER TABLE "Activity" ADD COLUMN "dewPointC" REAL;
ALTER TABLE "Activity" ADD COLUMN "elevationLossM" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "feel" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "gapDistanceM" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "hrHistogram" TEXT;
ALTER TABLE "Activity" ADD COLUMN "humidityPct" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "movingSec" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "pain" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "startLat" REAL;
ALTER TABLE "Activity" ADD COLUMN "startLng" REAL;
ALTER TABLE "Activity" ADD COLUMN "startUtc" TEXT;
ALTER TABLE "Activity" ADD COLUMN "subtype" TEXT;
ALTER TABLE "Activity" ADD COLUMN "tempC" REAL;
ALTER TABLE "Activity" ADD COLUMN "utcOffsetMin" INTEGER;
ALTER TABLE "Activity" ADD COLUMN "weatherSource" TEXT;
ALTER TABLE "Activity" ADD COLUMN "windKph" REAL;

-- CreateTable
CREATE TABLE "ActivityStream" (
    "activityId" TEXT NOT NULL PRIMARY KEY,
    "sampleSec" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "laps" TEXT,
    CONSTRAINT "ActivityStream_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityFile" (
    "activityId" TEXT NOT NULL PRIMARY KEY,
    "format" TEXT NOT NULL,
    "fileName" TEXT,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "gz" BLOB NOT NULL,
    CONSTRAINT "ActivityFile_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AthleteProfile" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "birthYear" INTEGER,
    "sex" TEXT,
    "heightCm" REAL,
    "weightKg" REAL,
    "hrMax" INTEGER,
    "hrMaxSource" TEXT,
    "hrRest" INTEGER,
    "lthr" INTEGER,
    "thresholdPaceSecPerKm" INTEGER,
    "runningSinceYear" INTEGER,
    "injuries" TEXT NOT NULL DEFAULT '[]',
    "availability" TEXT NOT NULL DEFAULT '{}',
    "longRunDay" TEXT NOT NULL DEFAULT 'sat',
    "terrain" TEXT NOT NULL DEFAULT '{}',
    "strengthPreference" INTEGER NOT NULL DEFAULT 2,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "homeLat" REAL,
    "homeLng" REAL,
    "useHomeWeather" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AthleteProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WellnessDay" (
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
    CONSTRAINT "WellnessDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Integration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "config" TEXT NOT NULL,
    "ingestTokenHash" TEXT,
    "cursor" TEXT,
    "lastSyncAt" DATETIME,
    "lastSyncStatus" TEXT,
    "lastError" TEXT,
    "pausedUntil" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Integration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileName" TEXT,
    "channel" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "activityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ImportedFile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "WellnessDay_userId_date_key" ON "WellnessDay"("userId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Integration_userId_provider_key" ON "Integration"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "ImportedFile_userId_sha256_key" ON "ImportedFile"("userId", "sha256");
