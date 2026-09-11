ALTER TABLE "LiveSession" ADD COLUMN "runpodPodId" TEXT;
ALTER TABLE "LiveSession" ADD COLUMN "podStatus" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "LiveSession" ADD COLUMN "podCreatedAt" DATETIME;
ALTER TABLE "LiveSession" ADD COLUMN "podTerminatedAt" DATETIME;
ALTER TABLE "LiveSession" ADD COLUMN "liveStartedAt" DATETIME;
ALTER TABLE "LiveSession" ADD COLUMN "deadlineAt" DATETIME;
ALTER TABLE "LiveSession" ADD COLUMN "endedReason" TEXT;
ALTER TABLE "LiveSession" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "LiveSession" ADD COLUMN "runtimeConfig" TEXT;

CREATE UNIQUE INDEX "LiveSession_runpodPodId_key"
ON "LiveSession"("runpodPodId");

CREATE UNIQUE INDEX "LiveSession_clientRequestId_key"
ON "LiveSession"("clientRequestId");
