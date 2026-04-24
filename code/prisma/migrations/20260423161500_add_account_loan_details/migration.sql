-- CreateEnum
CREATE TYPE "LoanType" AS ENUM ('MORTGAGE', 'AUTO_LOAN', 'PERSONAL_LOAN', 'HELOC', 'OTHER');

-- CreateEnum
CREATE TYPE "InterestType" AS ENUM ('FIXED', 'VARIABLE');

-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'SEMI_MONTHLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "LoanDetailSource" AS ENUM ('USER_ENTERED', 'IMPORTED', 'SYNCED');

-- CreateTable
CREATE TABLE "AccountLoanDetails" (
    "accountId" TEXT NOT NULL,
    "loanType" "LoanType" NOT NULL,
    "originalPrincipal" DECIMAL(15,2),
    "currentPrincipal" DECIMAL(15,2),
    "interestType" "InterestType",
    "interestRateAnnual" DECIMAL(7,4),
    "paymentAmount" DECIMAL(15,2),
    "paymentFrequency" "PaymentFrequency",
    "termStartDate" TIMESTAMP(3),
    "termMaturityDate" TIMESTAMP(3),
    "originalAmortizationMonths" INTEGER,
    "remainingAmortizationMonths" INTEGER,
    "renewalDate" TIMESTAMP(3),
    "notes" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "source" "LoanDetailSource" NOT NULL DEFAULT 'USER_ENTERED',
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountLoanDetails_pkey" PRIMARY KEY ("accountId")
);

-- CreateIndex
CREATE INDEX "AccountLoanDetails_loanType_idx" ON "AccountLoanDetails"("loanType");

-- AddForeignKey
ALTER TABLE "AccountLoanDetails" ADD CONSTRAINT "AccountLoanDetails_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
