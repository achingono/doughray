ALTER TABLE "Report" ADD COLUMN "dataRevision" INTEGER NOT NULL DEFAULT -1;

CREATE TABLE "ReportRevision" (
  "id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ReportRevision_pkey" PRIMARY KEY ("id")
);
INSERT INTO "ReportRevision" ("id", "revision") VALUES ('ledger', 0);

-- Update the revision in the same transaction as each source change, so a
-- report that was generated concurrently cannot appear current by accident.
CREATE FUNCTION doughray_invalidate_reports() RETURNS trigger AS $$
BEGIN
  UPDATE "ReportRevision" SET "revision" = "revision" + 1 WHERE "id" = 'ledger';
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER report_revision_account AFTER INSERT OR UPDATE OR DELETE ON "Account"
  FOR EACH STATEMENT EXECUTE FUNCTION doughray_invalidate_reports();
CREATE TRIGGER report_revision_transaction AFTER INSERT OR UPDATE OR DELETE ON "Transaction"
  FOR EACH STATEMENT EXECUTE FUNCTION doughray_invalidate_reports();
CREATE TRIGGER report_revision_category AFTER INSERT OR UPDATE OR DELETE ON "Category"
  FOR EACH STATEMENT EXECUTE FUNCTION doughray_invalidate_reports();
CREATE TRIGGER report_revision_asset AFTER INSERT OR UPDATE OR DELETE ON "Asset"
  FOR EACH STATEMENT EXECUTE FUNCTION doughray_invalidate_reports();
CREATE TRIGGER report_revision_snapshot AFTER INSERT OR UPDATE OR DELETE ON "NetWorthSnapshot"
  FOR EACH STATEMENT EXECUTE FUNCTION doughray_invalidate_reports();
