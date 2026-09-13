-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resumeCode" TEXT NOT NULL,
    "xenditInvoiceId" TEXT,
    "xenditExternalId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "durationHours" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IDR',
    "status" TEXT NOT NULL DEFAULT 'pending_payment',
    "sessionId" TEXT,
    "expiresAt" DATETIME,
    "paidAt" DATETIME,
    "consumedAt" DATETIME,
    "consumedReason" TEXT,
    "prepareAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastPrepareAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "Order_resumeCode_key" ON "Order"("resumeCode");
CREATE UNIQUE INDEX "Order_xenditInvoiceId_key" ON "Order"("xenditInvoiceId");
CREATE UNIQUE INDEX "Order_xenditExternalId_key" ON "Order"("xenditExternalId");

ALTER TABLE "LiveSession" ADD COLUMN "orderId" TEXT;

CREATE INDEX "LiveSession_orderId_idx" ON "LiveSession"("orderId");
