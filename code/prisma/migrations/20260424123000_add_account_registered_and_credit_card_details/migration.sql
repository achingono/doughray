-- CreateEnum
CREATE TYPE "RegistrationType" AS ENUM ('RRSP', 'TFSA', 'RESP', 'RIF', 'RDSP');

-- CreateEnum
CREATE TYPE "RegistrationVerificationSource" AS ENUM ('CRA_NOTICE_OF_ASSESSMENT', 'INSTITUTION_STATEMENT', 'USER_ENTERED', 'IMPORTED');

-- CreateEnum
CREATE TYPE "CreditCardRewardsProgram" AS ENUM ('NONE', 'CASH_BACK', 'POINTS', 'MILES', 'TRAVEL_CREDIT');

-- CreateEnum
CREATE TYPE "CreditCardType" AS ENUM ('CREDIT', 'CHARGE', 'SECURED');

-- CreateEnum
CREATE TYPE "CreditCardVerificationSource" AS ENUM ('INSTITUTION_STATEMENT', 'USER_ENTERED', 'SYNCED_FROM_ACCOUNT_AGGREGATOR');

-- CreateTable
CREATE TABLE "AccountRegisteredDetails" (
    "accountId" TEXT NOT NULL,
    "registrationType" "RegistrationType" NOT NULL,
    "annualContributionLimit" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "totalContributionRoom" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "contributedThisYear" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "unusedCarryforward" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "beneficiaryName" TEXT,
    "beneficiaryDateOfBirth" TIMESTAMP(3),
    "grantRoomAvailable" DECIMAL(15,2),
    "grantsReceived" DECIMAL(15,2),
    "subscriptionLimit" DECIMAL(15,2),
    "verificationSource" "RegistrationVerificationSource" NOT NULL DEFAULT 'USER_ENTERED',
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountRegisteredDetails_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "AccountCreditCardDetails" (
    "accountId" TEXT NOT NULL,
    "creditLimit" DECIMAL(15,2) NOT NULL,
    "currentUtilization" DECIMAL(5,2) NOT NULL,
    "annualPercentageRate" DECIMAL(7,4) NOT NULL,
    "minimumPaymentDueDate" INTEGER NOT NULL,
    "lastStatementBalance" DECIMAL(15,2) NOT NULL DEFAULT 0,
    "lastStatementDate" TIMESTAMP(3),
    "hasAnnualFee" BOOLEAN NOT NULL DEFAULT false,
    "annualFeeAmount" DECIMAL(15,2),
    "rewardsProgram" "CreditCardRewardsProgram",
    "rewardsRate" DECIMAL(8,4),
    "rewardsRedeemedThisYear" DECIMAL(15,2),
    "issuingBank" TEXT,
    "cardType" "CreditCardType",
    "verificationSource" "CreditCardVerificationSource" NOT NULL DEFAULT 'USER_ENTERED',
    "lastVerifiedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountCreditCardDetails_pkey" PRIMARY KEY ("accountId")
);

-- CreateIndex
CREATE INDEX "AccountRegisteredDetails_registrationType_idx" ON "AccountRegisteredDetails"("registrationType");

-- CreateIndex
CREATE INDEX "AccountRegisteredDetails_lastVerifiedAt_idx" ON "AccountRegisteredDetails"("lastVerifiedAt");

-- CreateIndex
CREATE INDEX "AccountCreditCardDetails_lastVerifiedAt_idx" ON "AccountCreditCardDetails"("lastVerifiedAt");

-- CreateIndex
CREATE INDEX "AccountCreditCardDetails_currentUtilization_idx" ON "AccountCreditCardDetails"("currentUtilization");

-- AddForeignKey
ALTER TABLE "AccountRegisteredDetails" ADD CONSTRAINT "AccountRegisteredDetails_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCreditCardDetails" ADD CONSTRAINT "AccountCreditCardDetails_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
