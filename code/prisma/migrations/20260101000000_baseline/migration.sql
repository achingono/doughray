-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'INVESTMENT', 'LOAN', 'MORTGAGE', 'OTHER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "BudgetPeriod" AS ENUM ('WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "ReportType" AS ENUM ('MONTHLY_SUMMARY', 'SPENDING_ANALYSIS', 'NET_WORTH_TREND', 'BUDGET_REVIEW', 'PERSONAL_FINANCIAL_STATEMENT');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "SyncStatus" AS ENUM ('RUNNING', 'SUCCESS', 'FAILED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "AssetType" AS ENUM ('REAL_ESTATE', 'AUTOMOBILE', 'STOCK');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "GoalStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'PAUSED', 'CANCELLED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum

DO $$
BEGIN
    CREATE TYPE "LoanTransactionRuleType" AS ENUM ('CATEGORY', 'PAYEE');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT,
    "institutionDomain" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "type" "AccountType" NOT NULL DEFAULT 'CHECKING',
    "balance" DECIMAL(15,2) NOT NULL,
    "availableBalance" DECIMAL(15,2),
    "balanceDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "backfillCursor" TIMESTAMP(3),
    "backfillComplete" BOOLEAN NOT NULL DEFAULT false,
    "backfillUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Transaction" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "posted" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "description" TEXT NOT NULL,
    "payee" TEXT,
    "memo" TEXT,
    "categoryId" TEXT,
    "categoryRuleId" TEXT,
    "isReviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "parentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CategoryRule" (
    "id" TEXT NOT NULL,
    "normalizedPayee" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "accountId" TEXT,
    "sourceTransactionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CategoryRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Budget" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "period" "BudgetPeriod" NOT NULL DEFAULT 'MONTHLY',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "content" JSONB NOT NULL,
    "period" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "SyncLog" (
    "id" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "accountCount" INTEGER NOT NULL DEFAULT 0,
    "transactionCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "NetWorthSnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "totalAssets" DECIMAL(15,2) NOT NULL,
    "totalLiabilities" DECIMAL(15,2) NOT NULL,
    "netWorth" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NetWorthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AccountNetWorthSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "accountType" "AccountType" NOT NULL,
    "balance" DECIMAL(15,2) NOT NULL,
    "netWorth" DECIMAL(15,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountNetWorthSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL DEFAULT 'REAL_ESTATE',
    "purchasePrice" DECIMAL(15,2) NOT NULL,
    "currentValue" DECIMAL(15,2) NOT NULL,
    "purchaseDate" TIMESTAMP(3),
    "address" TEXT,
    "metadata" JSONB,
    "lastValuationDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AssetValuation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "value" DECIMAL(15,2) NOT NULL,
    "source" TEXT NOT NULL,
    "valuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetValuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Goal" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetAmount" DECIMAL(15,2) NOT NULL,
    "currentAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "targetDate" TIMESTAMP(3),
    "status" "GoalStatus" NOT NULL DEFAULT 'ACTIVE',
    "icon" TEXT,
    "color" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GoalAccount" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,

    CONSTRAINT "GoalAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LoanTransactionRule" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ruleType" "LoanTransactionRuleType" NOT NULL,
    "categoryId" TEXT,
    "normalizedPayee" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LoanTransactionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LoanTransaction" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "sourceTransactionId" TEXT NOT NULL,
    "linkedAccountId" TEXT NOT NULL,
    "amount" DECIMAL(15,2) NOT NULL,
    "posted" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Account_externalId_key" ON "Account"("externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Account_type_idx" ON "Account"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Account_isActive_idx" ON "Account"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Transaction_externalId_key" ON "Transaction"("externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_accountId_idx" ON "Transaction"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_categoryId_idx" ON "Transaction"("categoryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_categoryRuleId_idx" ON "Transaction"("categoryRuleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_posted_idx" ON "Transaction"("posted");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Transaction_accountId_posted_idx" ON "Transaction"("accountId", "posted");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CategoryRule_normalizedPayee_idx" ON "CategoryRule"("normalizedPayee");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CategoryRule_categoryId_idx" ON "CategoryRule"("categoryId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CategoryRule_normalizedPayee_accountId_key" ON "CategoryRule"("normalizedPayee", "accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Budget_categoryId_idx" ON "Budget"("categoryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Report_type_idx" ON "Report"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Report_period_idx" ON "Report"("period");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncLog_status_idx" ON "SyncLog"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "SyncLog_startedAt_idx" ON "SyncLog"("startedAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "NetWorthSnapshot_date_key" ON "NetWorthSnapshot"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "NetWorthSnapshot_date_idx" ON "NetWorthSnapshot"("date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AccountNetWorthSnapshot_date_idx" ON "AccountNetWorthSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AccountNetWorthSnapshot_accountId_date_key" ON "AccountNetWorthSnapshot"("accountId", "date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Asset_type_idx" ON "Asset"("type");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AssetValuation_assetId_valuedAt_idx" ON "AssetValuation"("assetId", "valuedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Goal_status_idx" ON "Goal"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GoalAccount_goalId_idx" ON "GoalAccount"("goalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GoalAccount_accountId_idx" ON "GoalAccount"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GoalAccount_goalId_accountId_key" ON "GoalAccount"("goalId", "accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoanTransactionRule_accountId_idx" ON "LoanTransactionRule"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoanTransactionRule_categoryId_idx" ON "LoanTransactionRule"("categoryId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoanTransactionRule_isActive_idx" ON "LoanTransactionRule"("isActive");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoanTransaction_linkedAccountId_idx" ON "LoanTransaction"("linkedAccountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoanTransaction_ruleId_idx" ON "LoanTransaction"("ruleId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LoanTransaction_posted_idx" ON "LoanTransaction"("posted");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "LoanTransaction_sourceTransactionId_linkedAccountId_key" ON "LoanTransaction"("sourceTransactionId", "linkedAccountId");

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_accountId_fkey') THEN
        ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_categoryId_fkey') THEN
        ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Transaction_categoryRuleId_fkey') THEN
        ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryRuleId_fkey" FOREIGN KEY ("categoryRuleId") REFERENCES "CategoryRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Category_parentId_fkey') THEN
        ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CategoryRule_categoryId_fkey') THEN
        ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CategoryRule_accountId_fkey') THEN
        ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Budget_categoryId_fkey') THEN
        ALTER TABLE "Budget" ADD CONSTRAINT "Budget_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AccountNetWorthSnapshot_accountId_fkey') THEN
        ALTER TABLE "AccountNetWorthSnapshot" ADD CONSTRAINT "AccountNetWorthSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AssetValuation_assetId_fkey') THEN
        ALTER TABLE "AssetValuation" ADD CONSTRAINT "AssetValuation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalAccount_goalId_fkey') THEN
        ALTER TABLE "GoalAccount" ADD CONSTRAINT "GoalAccount_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'GoalAccount_accountId_fkey') THEN
        ALTER TABLE "GoalAccount" ADD CONSTRAINT "GoalAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoanTransactionRule_accountId_fkey') THEN
        ALTER TABLE "LoanTransactionRule" ADD CONSTRAINT "LoanTransactionRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoanTransactionRule_categoryId_fkey') THEN
        ALTER TABLE "LoanTransactionRule" ADD CONSTRAINT "LoanTransactionRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoanTransaction_ruleId_fkey') THEN
        ALTER TABLE "LoanTransaction" ADD CONSTRAINT "LoanTransaction_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "LoanTransactionRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoanTransaction_sourceTransactionId_fkey') THEN
        ALTER TABLE "LoanTransaction" ADD CONSTRAINT "LoanTransaction_sourceTransactionId_fkey" FOREIGN KEY ("sourceTransactionId") REFERENCES "Transaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

-- AddForeignKey

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoanTransaction_linkedAccountId_fkey') THEN
        ALTER TABLE "LoanTransaction" ADD CONSTRAINT "LoanTransaction_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

