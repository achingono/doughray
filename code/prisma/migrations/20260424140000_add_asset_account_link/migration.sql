-- AlterTable: Add accountId foreign key to Asset table to link assets to liability accounts
ALTER TABLE "Asset" ADD COLUMN "accountId" TEXT;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Asset_accountId_idx" ON "Asset"("accountId");
