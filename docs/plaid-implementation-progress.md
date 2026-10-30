# Plaid implementation progress

Updated October 30, 2026. This records the state after implementing the first Plaid work packages in [the review](plaid-implementation-review.md).

Implemented: owner login and CSRF handling; Plaid Link and OAuth return UI; encrypted Item tokens; connection management; account mapping; cursor-based queued synchronization; verified webhooks; account balance and transaction normalization; pending-to-posted and removal handling; migration staging, explicit one-to-one review, and publication of the reviewed snapshot; category preservation; posted-only financial queries; and safe handling of incomplete migration histories. Sync errors do not advance the cursor. [Setup instructions](plaid-setup.md) describe provisioning and the account review workflow.

The test suite includes signed webhooks, concurrent queue submission, migration review and cutover, duplicate-purchase decisions, rollback on unmapped data, session/CSRF checks, and isolated PostgreSQL migrations. These are fixture-based tests and do not establish that a real institution, OAuth redirect, or Production trial Item works.

Latest verification: the root workspace build passed; 142 API tests, 69 frontend tests (with Toronto timezone), 12 worker tests, and 10 disposable-PostgreSQL integration tests passed. API, worker, and frontend Docker images also built successfully. Fresh and historically migrated databases matched the Prisma schema; a partial unversioned database stopped without losing its sentinel data. Approved staged snapshots now enforce the configured Plaid environment and token key version, and review refresh is serialized with approval/publication. The database matrix can be repeated from `code` using `npm run test:plaid:db`; it creates and removes its own Docker container and does not use the configured application database.

The next development deliverable is durable quarantine and version-aware replay, followed by expanded reconciliation search, saved drafts and undo, downstream report invalidation, and token rotation/exchange recovery. Sandbox browser validation can proceed in parallel with that work; real-account cutover still requires verification of the recovery procedures and a copy of the deployment database.

Remaining before treating the original plan as complete:

1. Validate Plaid Link, OAuth redirect, account availability, and transaction/history webhooks against Sandbox, then exercise one real trial connection and compare it with a backup before migrating the rest. No live Plaid calls or production deployment have been performed as part of this implementation.
2. Add a full post-sync reconciliation undo/rollback workflow. The current audit records approval and supports a fresh preview before approval, but does not restore the previous provider and all subsequent changes. Keep a database backup and do not re-enable SimpleFin for a migrated account without reconciling the overlap.
3. Add durable quarantine and repair/replay. An invalid provider record currently fails the job while preserving the original cursor. It does not create a repairable quarantine item or allow partial publication.
4. Expand reconciliation beyond the current candidate window (three calendar days and at most 100 records per transaction), persist draft decisions, and support searching older/different records. Until then, leave a review unfinished if a known match is absent.
5. Validate upgrade procedures using a copy of the actual deployment database. Fresh schemas, recorded historical migrations, and an incomplete legacy schema were exercised in disposable PostgreSQL; an unversioned schema is deliberately not automatically baselined.
6. Complete token-key rotation and Item exchange recovery across every external-call/database-failure boundary. A token is encrypted before durable persistence, but a process failure immediately after Plaid exchanges a public token can still strand an Item. Trial connection reservations are local safeguards, not authoritative Plaid quota.
7. Finish downstream invalidation: existing generated reports are not automatically marked stale after corrections, and historical snapshot reconstruction is intentionally paused for Plaid accounts because coverage is not established. Mixed-currency aggregate reporting and complete derived loan-rule repair need separate validation.
8. Test the deployed browser CSP and the exact OAuth URL with Plaid. The policy permits Plaid's documented script, frame, and API origins, but has not been exercised with the live Link widget.

The trial credentials already supplied in `.env` also need `PLAID_ENV`, `BANK_TOKEN_ENCRYPTION_KEY`, and `OWNER_PASSWORD_HASH` before the application can be used. These were not generated or changed automatically.
