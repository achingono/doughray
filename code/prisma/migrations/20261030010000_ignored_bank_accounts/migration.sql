CREATE TABLE "IgnoredBankAccount" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "externalAccountId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IgnoredBankAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "IgnoredBankAccount_connectionId_externalAccountId_key"
  ON "IgnoredBankAccount"("connectionId", "externalAccountId");
ALTER TABLE "IgnoredBankAccount" ADD CONSTRAINT "IgnoredBankAccount_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
