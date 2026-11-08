# Plaid implementation progress

Updated November 8, 2026. The original [review](plaid-implementation-review.md) describes the earlier foundation and is retained as a historical assessment.

The application now has owner authentication, Plaid Link and OAuth return handling, encrypted tokens, account mapping and exclusion, leased sync jobs, verified webhooks, normalization, pending/posted/removal handling, and reviewed migration from SimpleFin. Recovery work includes quarantine with version-aware replay, saved review drafts, conflict-checked undo, report freshness tracking, and an offline key-rotation command. Plaid transaction changes and category updates also repair derived loan links atomically. See [setup](plaid-setup.md) for operation and limitations.

During the October Sandbox validation, a disposable app exchanged a synthetic Item, mapped 13 accounts, excluded one account with an unsupported balance precision, and imported transactions. A subsequent synthetic transaction appeared after an incremental sync. The Link widget loaded under the app's CSP. The user reported completing the OAuth popup; the temporary database and tunnel are no longer available to verify that particular OAuth Item's persistence and follow-on sync. These results do not validate a real institution or Production deployment.

The review now supports searching the same account for posted transactions with the exact amount and compatible currency on other dates. Search results are added only on explicit selection; draft save and approval preserve one-to-one matching and reject a changed selected transaction. Different amounts and currencies are intentionally not eligible for matching.

Remaining work:

1. Repeat the Sandbox OAuth flow in a disposable environment and verify the returned Item, encrypted token, account mapping, initial sync, and subsequent update end to end. Exercise the configured redirect and CSP in the target deployment.
2. Verify migration against a backup copy of the actual deployment database. An unversioned database is not automatically baselined.
3. Address the external exchange-to-database failure window. A process failure immediately after Plaid exchanges a public token can strand an Item before its access token is persisted.
4. Support safe remapping or recovery for excluded and undone accounts after a cursor advances. Current safeguards prevent remapping on that Item because previously skipped history may be unavailable.
5. Validate mixed-currency aggregates and historical snapshot reconstruction. Reports are marked stale when source data changes; historical snapshots for Plaid accounts remain conservative where coverage is unknown. After changing a loan rule, run the loan tracker to reconcile existing history.
6. Validate recovery procedures and reconciliation against a backup, then trial one real connection before migrating the remaining accounts. Undo intentionally refuses conflicts rather than overwriting later changes.

November 8 verification: the workspace build passed, along with 144 API tests, 72 frontend tests, 12 worker tests, and 24 PostgreSQL integration tests. The disposable migration matrix also passed for fresh, historical, and deliberately incomplete schemas. These tests use fixtures and do not replace the remaining OAuth and deployment validation.

The user's `.env` needs the appropriate Plaid environment, encryption key, and owner password hash before application use. Avoid exposing or committing credentials.
