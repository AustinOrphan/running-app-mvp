-- CreateTable
CREATE TABLE "DeliveryChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "garminLinked" BOOLEAN NOT NULL DEFAULT false,
    "dataKey" TEXT,
    "lastRunAt" DATETIME,
    "pausedUntil" DATETIME,
    "referenceJson" TEXT,
    "tokenHash" TEXT,
    "tokenCreatedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DeliveryChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WristPublication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "variant" TEXT NOT NULL DEFAULT 'planned',
    "title" TEXT NOT NULL,
    "remoteId" TEXT,
    "state" TEXT NOT NULL,
    "desiredHash" TEXT NOT NULL,
    "sentHash" TEXT,
    "failCode" TEXT,
    "failMessage" TEXT,
    "deviceMessage" TEXT,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME,
    "sentAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WristPublication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryChannel_tokenHash_key" ON "DeliveryChannel"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryChannel_userId_channel_key" ON "DeliveryChannel"("userId", "channel");

-- CreateIndex
CREATE INDEX "WristPublication_userId_channel_date_idx" ON "WristPublication"("userId", "channel", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WristPublication_userId_channel_externalId_key" ON "WristPublication"("userId", "channel", "externalId");
