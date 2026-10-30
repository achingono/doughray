-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "BankProvider" AS ENUM ('SIMPLEFIN', 'PLAID');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "BankEnvironment" AS ENUM ('SANDBOX', 'PRODUCTION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "ConnectionHealth" AS ENUM ('HEALTHY', 'AUTH_REQUIRED', 'CONSENT_REVOKED', 'ERROR', 'DISCONNECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "SyncProcessState" AS ENUM ('NOT_READY', 'PROCESSING', 'FAILED', 'COMPLETE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "AccountIngestionState" AS ENUM ('ACTIVE', 'MIGRATING', 'PAUSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "AccountSourceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CONSENT_EXPIRED', 'REVOKED', 'REMOVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "TransactionStatus" AS ENUM ('PENDING', 'POSTED', 'REMOVED', 'SUPERSEDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "TransactionCategoryOwnership" AS ENUM ('NONE', 'AI', 'RULE', 'USER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "TransactionSourceStatus" AS ENUM ('ACTIVE', 'REMOVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "ProviderOperationDirection" AS ENUM ('INFLOW', 'OUTFLOW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "SyncJobType" AS ENUM ('CONNECTION_SYNC', 'SIMPLEFIN_IMPORT', 'SIMPLEFIN_BACKFILL', 'BANK_REFRESH', 'CATEGORIZE', 'QUARANTINE_REPLAY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "SyncJobTrigger" AS ENUM ('SCHEDULED', 'MANUAL', 'WEBHOOK', 'STARTUP');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "SyncJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "SyncBatchStatus" AS ENUM ('STAGED', 'PUBLISHED', 'PUBLISHED_PARTIAL', 'QUARANTINED', 'DISCARDED', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "SyncBatchChangeType" AS ENUM ('ADDED', 'MODIFIED', 'REMOVED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "LinkAttemptMode" AS ENUM ('NEW', 'UPDATE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "LinkAttemptStatus" AS ENUM ('CREATED', 'EXCHANGED', 'PERSISTED', 'FAILED', 'EXPIRED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "QuarantineStatus" AS ENUM ('OPEN', 'REPLAYING', 'RESOLVED', 'DISCARDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "ReconciliationCaseKind" AS ENUM ('MIGRATION_PREVIEW', 'MIGRATION_COMMIT', 'QUARANTINE_REVIEW');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "ReconciliationCaseStatus" AS ENUM ('OPEN', 'COMMITTED', 'UNDONE', 'DISCARDED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "ReconciliationDecisionAction" AS ENUM ('SAME_TRANSACTION', 'KEEP_BOTH', 'NEW_TRANSACTION', 'DEFER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "ReconciliationAuditAction" AS ENUM ('PLAN_APPLIED', 'MAPPING_MERGED', 'SOURCE_SWITCHED', 'FACTS_UPDATED', 'UNDONE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "WebhookReceiptStatus" AS ENUM ('RECEIVED', 'DISPATCHED', 'DUPLICATE', 'REJECTED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "Account" ADD COLUMN IF NOT EXISTS "candidateSourceId" TEXT,
ADD COLUMN IF NOT EXISTS "ingestionState" "AccountIngestionState" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "authorizedDate" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "categoryOwnership" "TransactionCategoryOwnership" NOT NULL DEFAULT 'NONE',
ADD COLUMN IF NOT EXISTS "isoCurrencyCode" TEXT,
ADD COLUMN IF NOT EXISTS "replacementTransactionId" TEXT,
ADD COLUMN IF NOT EXISTS "status" "TransactionStatus" NOT NULL DEFAULT 'POSTED';

-- CreateTable
CREATE TABLE IF NOT EXISTS "BankConnection" (
    "id" TEXT NOT NULL,
    "provider" "BankProvider" NOT NULL,
    "environment" "BankEnvironment" NOT NULL,
    "externalItemId" TEXT NOT NULL,
    "institutionName" TEXT,
    "institutionLogoUrl" TEXT,
    "tokenCiphertext" TEXT,
    "tokenNonce" TEXT,
    "tokenAuthTag" TEXT,
    "tokenKeyVersion" INTEGER,
    "status" "ConnectionHealth" NOT NULL DEFAULT 'HEALTHY',
    "healthDetail" TEXT,
    "consentExpiresAt" TIMESTAMP(3),
    "transactionsInitialState" "SyncProcessState",
    "transactionsHistoryState" "SyncProcessState",
    "transactionCursor" TEXT,
    "transactionCursorUpdatedAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "pausedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LinkAttempt" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "mode" "LinkAttemptMode" NOT NULL DEFAULT 'NEW',
    "provider" "BankProvider" NOT NULL DEFAULT 'PLAID',
    "environment" "BankEnvironment" NOT NULL,
    "status" "LinkAttemptStatus" NOT NULL DEFAULT 'CREATED',
    "linkToken" TEXT,
    "linkTokenExpiresAt" TIMESTAMP(3),
    "exchangeSessionId" TEXT,
    "recoveryPublicTokenCiphertext" TEXT,
    "connectionId" TEXT,
    "institutionName" TEXT,
    "institutionId" TEXT,
    "requestId" TEXT,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountSource" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "mask" TEXT,
    "officialName" TEXT,
    "providerType" TEXT,
    "providerSubtype" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "AccountSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "availableBalance" DECIMAL(15,2),
    "balanceObservedAt" TIMESTAMP(3),
    "balanceStale" BOOLEAN NOT NULL DEFAULT false,
    "externalCreatedAt" TIMESTAMP(3),
    "externalUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TransactionSource" (
    "id" TEXT NOT NULL,
    "accountSourceId" TEXT NOT NULL,
    "externalTransactionId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "status" "TransactionSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "pendingExternalId" TEXT,
    "observedFacts" JSONB NOT NULL,
    "sourceRevision" TEXT,
    "sourceBatchId" TEXT,
    "pendingTransactionSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TransactionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncJob" (
    "id" TEXT NOT NULL,
    "jobType" "SyncJobType" NOT NULL,
    "connectionId" TEXT,
    "trigger" "SyncJobTrigger" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRunAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "rerunRequested" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "modifiedCount" INTEGER NOT NULL DEFAULT 0,
    "removedCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "quarantinedCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "requestId" TEXT,
    "payload" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncBatch" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" "SyncBatchStatus" NOT NULL DEFAULT 'STAGED',
    "cursorStart" TEXT NOT NULL,
    "cursorEnd" TEXT,
    "addedCount" INTEGER NOT NULL DEFAULT 0,
    "modifiedCount" INTEGER NOT NULL DEFAULT 0,
    "removedCount" INTEGER NOT NULL DEFAULT 0,
    "quarantinedCount" INTEGER NOT NULL DEFAULT 0,
    "isHistorical" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "stagedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "accountSourceId" TEXT,
    "externalTransactionId" TEXT NOT NULL,
    "changeType" "SyncBatchChangeType" NOT NULL,
    "observedFacts" JSONB NOT NULL,
    "appliedTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "QuarantineItem" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "batchId" TEXT,
    "accountSourceId" TEXT,
    "externalTransactionId" TEXT,
    "reason" TEXT NOT NULL,
    "status" "QuarantineStatus" NOT NULL DEFAULT 'OPEN',
    "sourcePayload" JSONB NOT NULL,
    "replayCount" INTEGER NOT NULL DEFAULT 0,
    "lastReplayAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "expireAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuarantineItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReconciliationCase" (
    "id" TEXT NOT NULL,
    "kind" "ReconciliationCaseKind" NOT NULL,
    "status" "ReconciliationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "connectionId" TEXT,
    "accountSourceId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "manifest" JSONB,
    "candidatesJson" JSONB,
    "coverageJson" JSONB,
    "totalsJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReconciliationCandidate" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "plaidSourceTransactionId" TEXT,
    "simplefinSourceTransactionId" TEXT,
    "plaidTransactionExternalId" TEXT,
    "simplefinTransactionExternalId" TEXT,
    "accountId" TEXT NOT NULL,
    "accountSourceId" TEXT,
    "proposedAction" "ReconciliationDecisionAction" NOT NULL,
    "confidence" DECIMAL(5,4),
    "evidence" JSONB NOT NULL,
    "decided" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReconciliationDecision" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "candidateId" TEXT,
    "primaryTransactionId" TEXT,
    "matchedTransactionId" TEXT,
    "action" "ReconciliationDecisionAction" NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'owner',
    "applyProviderFacts" BOOLEAN NOT NULL DEFAULT false,
    "appliedAt" TIMESTAMP(3),
    "appliedVersion" INTEGER NOT NULL DEFAULT 1,
    "undoneAt" TIMESTAMP(3),
    "undoneBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReconciliationDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ReconciliationAudit" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "action" "ReconciliationAuditAction" NOT NULL,
    "actor" TEXT NOT NULL DEFAULT 'owner',
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WebhookReceipt" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "provider" "BankProvider" NOT NULL DEFAULT 'PLAID',
    "environment" "BankEnvironment" NOT NULL,
    "webhookType" TEXT NOT NULL,
    "webhookCode" TEXT NOT NULL,
    "itemId" TEXT,
    "bodySha256" TEXT NOT NULL,
    "signatureKeyId" TEXT,
    "verificationState" TEXT NOT NULL,
    "status" "WebhookReceiptStatus" NOT NULL DEFAULT 'RECEIVED',
    "payloadSafe" JSONB,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AuthSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankConnection_provider_environment_idx" ON "BankConnection"("provider", "environment");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BankConnection_status_idx" ON "BankConnection"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "BankConnection_provider_environment_externalItemId_key" ON "BankConnection"("provider", "environment", "externalItemId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LinkAttempt_sessionId_idx" ON "LinkAttempt"("sessionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LinkAttempt_status_idx" ON "LinkAttempt"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LinkAttempt_connectionId_idx" ON "LinkAttempt"("connectionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountSource_accountId_idx" ON "AccountSource"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountSource_connectionId_idx" ON "AccountSource"("connectionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountSource_status_idx" ON "AccountSource"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountSource_connectionId_externalAccountId_key" ON "AccountSource"("connectionId", "externalAccountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TransactionSource_transactionId_idx" ON "TransactionSource"("transactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TransactionSource_pendingExternalId_idx" ON "TransactionSource"("pendingExternalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TransactionSource_sourceBatchId_idx" ON "TransactionSource"("sourceBatchId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TransactionSource_accountSourceId_externalTransactionId_key" ON "TransactionSource"("accountSourceId", "externalTransactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncJob_status_nextRunAt_idx" ON "SyncJob"("status", "nextRunAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncJob_connectionId_idx" ON "SyncJob"("connectionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncJob_jobType_trigger_idx" ON "SyncJob"("jobType", "trigger");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncBatch_connectionId_idx" ON "SyncBatch"("connectionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncBatch_status_idx" ON "SyncBatch"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncBatch_jobId_idx" ON "SyncBatch"("jobId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncBatchItem_batchId_changeType_idx" ON "SyncBatchItem"("batchId", "changeType");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "SyncBatchItem_batchId_externalTransactionId_key" ON "SyncBatchItem"("batchId", "externalTransactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "QuarantineItem_status_idx" ON "QuarantineItem"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "QuarantineItem_connectionId_idx" ON "QuarantineItem"("connectionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "QuarantineItem_createdAt_idx" ON "QuarantineItem"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReconciliationCase_status_idx" ON "ReconciliationCase"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReconciliationCase_connectionId_idx" ON "ReconciliationCase"("connectionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReconciliationCandidate_caseId_idx" ON "ReconciliationCandidate"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReconciliationCandidate_accountId_idx" ON "ReconciliationCandidate"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReconciliationCandidate_decided_idx" ON "ReconciliationCandidate"("decided");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ReconciliationCandidate_caseId_plaidSourceTransactionId_sim_key" ON "ReconciliationCandidate"("caseId", "plaidSourceTransactionId", "simplefinSourceTransactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReconciliationDecision_caseId_idx" ON "ReconciliationDecision"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReconciliationDecision_primaryTransactionId_idx" ON "ReconciliationDecision"("primaryTransactionId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReconciliationAudit_caseId_idx" ON "ReconciliationAudit"("caseId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReconciliationAudit_createdAt_idx" ON "ReconciliationAudit"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebhookReceipt_status_idx" ON "WebhookReceipt"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebhookReceipt_receivedAt_idx" ON "WebhookReceipt"("receivedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WebhookReceipt_bodySha256_idx" ON "WebhookReceipt"("bodySha256");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_status_idx" ON "Transaction"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_accountId_status_posted_idx" ON "Transaction"("accountId", "status", "posted");

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Account_candidateSourceId_fkey') THEN
        ALTER TABLE "Account" ADD CONSTRAINT "Account_candidateSourceId_fkey" FOREIGN KEY ("candidateSourceId") REFERENCES "AccountSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_replacementTransactionId_fkey') THEN
        ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_replacementTransactionId_fkey" FOREIGN KEY ("replacementTransactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LinkAttempt_connectionId_fkey') THEN
        ALTER TABLE "LinkAttempt" ADD CONSTRAINT "LinkAttempt_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountSource_connectionId_fkey') THEN
        ALTER TABLE "AccountSource" ADD CONSTRAINT "AccountSource_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountSource_accountId_fkey') THEN
        ALTER TABLE "AccountSource" ADD CONSTRAINT "AccountSource_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TransactionSource_accountSourceId_fkey') THEN
        ALTER TABLE "TransactionSource" ADD CONSTRAINT "TransactionSource_accountSourceId_fkey" FOREIGN KEY ("accountSourceId") REFERENCES "AccountSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TransactionSource_transactionId_fkey') THEN
        ALTER TABLE "TransactionSource" ADD CONSTRAINT "TransactionSource_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TransactionSource_pendingTransactionSourceId_fkey') THEN
        ALTER TABLE "TransactionSource" ADD CONSTRAINT "TransactionSource_pendingTransactionSourceId_fkey" FOREIGN KEY ("pendingTransactionSourceId") REFERENCES "TransactionSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SyncJob_connectionId_fkey') THEN
        ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SyncBatch_connectionId_fkey') THEN
        ALTER TABLE "SyncBatch" ADD CONSTRAINT "SyncBatch_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SyncBatch_jobId_fkey') THEN
        ALTER TABLE "SyncBatch" ADD CONSTRAINT "SyncBatch_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "SyncJob"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SyncBatchItem_batchId_fkey') THEN
        ALTER TABLE "SyncBatchItem" ADD CONSTRAINT "SyncBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SyncBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SyncBatchItem_accountSourceId_fkey') THEN
        ALTER TABLE "SyncBatchItem" ADD CONSTRAINT "SyncBatchItem_accountSourceId_fkey" FOREIGN KEY ("accountSourceId") REFERENCES "AccountSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuarantineItem_connectionId_fkey') THEN
        ALTER TABLE "QuarantineItem" ADD CONSTRAINT "QuarantineItem_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'QuarantineItem_accountSourceId_fkey') THEN
        ALTER TABLE "QuarantineItem" ADD CONSTRAINT "QuarantineItem_accountSourceId_fkey" FOREIGN KEY ("accountSourceId") REFERENCES "AccountSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReconciliationCase_connectionId_fkey') THEN
        ALTER TABLE "ReconciliationCase" ADD CONSTRAINT "ReconciliationCase_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReconciliationCandidate_caseId_fkey') THEN
        ALTER TABLE "ReconciliationCandidate" ADD CONSTRAINT "ReconciliationCandidate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReconciliationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReconciliationCandidate_accountSourceId_fkey') THEN
        ALTER TABLE "ReconciliationCandidate" ADD CONSTRAINT "ReconciliationCandidate_accountSourceId_fkey" FOREIGN KEY ("accountSourceId") REFERENCES "AccountSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReconciliationDecision_caseId_fkey') THEN
        ALTER TABLE "ReconciliationDecision" ADD CONSTRAINT "ReconciliationDecision_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReconciliationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReconciliationDecision_candidateId_fkey') THEN
        ALTER TABLE "ReconciliationDecision" ADD CONSTRAINT "ReconciliationDecision_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ReconciliationCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReconciliationDecision_primaryTransactionId_fkey') THEN
        ALTER TABLE "ReconciliationDecision" ADD CONSTRAINT "ReconciliationDecision_primaryTransactionId_fkey" FOREIGN KEY ("primaryTransactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReconciliationDecision_matchedTransactionId_fkey') THEN
        ALTER TABLE "ReconciliationDecision" ADD CONSTRAINT "ReconciliationDecision_matchedTransactionId_fkey" FOREIGN KEY ("matchedTransactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ReconciliationAudit_caseId_fkey') THEN
        ALTER TABLE "ReconciliationAudit" ADD CONSTRAINT "ReconciliationAudit_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "ReconciliationCase"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebhookReceipt_connectionId_fkey') THEN
        ALTER TABLE "WebhookReceipt" ADD CONSTRAINT "WebhookReceipt_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

