-- CreateTable
CREATE TABLE "Avatar" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "style" TEXT,
    "language" TEXT,
    "voice" TEXT,
    "sampleAudioUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "productId" TEXT NOT NULL,
    "avatarId" TEXT NOT NULL,
    "voice" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "platform" TEXT NOT NULL,
    "durationHours" INTEGER NOT NULL,
    "autoReply" BOOLEAN NOT NULL DEFAULT true,
    "autoPin" BOOLEAN NOT NULL DEFAULT true,
    "autoPromotion" BOOLEAN NOT NULL DEFAULT true,
    "autoModeration" BOOLEAN NOT NULL DEFAULT true,
    "estimatedCost" INTEGER,
    "revenueEstimate" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LiveSession_avatarId_fkey" FOREIGN KEY ("avatarId") REFERENCES "Avatar" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CostBenchmark" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "metricName" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "unit" TEXT NOT NULL,
    "provider" TEXT,
    "benchmarkAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT
);
