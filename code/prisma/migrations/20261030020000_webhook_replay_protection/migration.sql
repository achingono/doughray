-- Existing receipts have no signature digest and remain readable.
ALTER TABLE "WebhookReceipt" ADD COLUMN "signatureDigest" TEXT;
CREATE UNIQUE INDEX "WebhookReceipt_environment_signatureDigest_key"
  ON "WebhookReceipt"("environment", "signatureDigest");
