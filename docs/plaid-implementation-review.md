# Plaid implementation review and next steps

Reviewed October 29, 2026 against the working tree based on `a5c5a3a` and [the implementation plan](plaid-implementation-plan.md). This review includes tracked edits and new, untracked files. No application code was changed by the review.

**Assessment: partial backend foundation; not ready to deploy or migrate real accounts.** Configuration, schema, encryption helpers, authentication middleware, Link endpoints, and queue submission have been started. There is no end-to-end linking UI or transaction ingestion worker. Several foundation defects need correction before continuing with the remaining features.

## Verified status

| Capability | State | Evidence / remaining work |
| --- | --- | --- |
| Plaid configuration and dependencies | Partial | SDK and React dependency added; Compose forwards settings; runtime settings validation exists. Validation, environment isolation, and deployed setup still need tests. |
| Schema and migrations | Partial | Models for connections, identities, jobs, batches, quarantine, reconciliation, sessions, and transaction status exist. Legacy migrations are deleted/replaced; legacy identity/category ownership backfill is absent. |
| Token protection and owner authentication | Partial | AES-GCM encryption, password hashing, session cookies, CSRF checks, login routes. No login UI, client CSRF handling, or key rotation implementation. |
| Linking and connection management | Partial | Backend Link creation/exchange/update, inventory, mapping, pause/resume/disconnect routes exist. No browser Link/OAuth return flow; lifecycle operations have atomicity/idempotency gaps. |
| Transaction synchronization | Missing execution | SDK can fetch one sync page; API attempts to queue jobs. Worker still directly runs SimpleFin jobs. No queue consumer, pagination loop, staged publication, or cursor commit. |
| Webhooks | Partial / unsafe recovery | Signature/body verification and receipt handling exist. Receipt deduplication can suppress undispatched events. |
| Sanitization and normalization | Partial / incorrect | Decimal/text/date helpers exist, but balance signs, missing values, account types, and provider error handling need fixes. No complete quarantine or safe AI projection pipeline. |
| Reconciliation and cutover | Schema only | No preview, matching, decisions, atomic cutover, replay, undo, or SimpleFin authority enforcement. |
| Reporting integration | Missing | Existing queries do not filter the new transaction lifecycle status. Loan-derived records and snapshots have not been integrated. |
| Tests | Insufficient for new work | No dedicated Plaid/auth/queue/reconciliation test files found. Existing route tests bypass the new top-level auth middleware. |

## Findings, ordered by impact

### F1 — P1: API does not compile, and queue submission also fails at runtime

`npm run build` fails in the API. New errors include `CryptoKey` typing in `api/src/lib/plaid-webhook.ts:122`, a nonexistent `Prisma.BankConnectionSelectNonNullable` type in `api/src/services/bank-dto.ts:33`, route parameter/environment typing, and `connectionId` assignment in `plaid-link.service.ts`. Additional errors occur in the existing transaction routes and must be resolved or separately explained before declaring the build green.

`api/src/services/sync-queue.service.ts:3` imports `SyncJobStatus` with `import type`, then accesses it as a runtime enum at lines 33 and 39. Transpile-only execution therefore cannot enqueue a job. The sync integration test returns 500; it also needs updating from the old 200 response to the intended 202 contract and must mock/test actual queue submission.

**Fix:** correct imports and types rather than bypassing checks; return the created connection ID from the transaction callback; validate route inputs; use Prisma JSON input types. Require a clean root build and queue route tests.

### F2 — P1: deploying the new auth guard breaks the existing frontend

`api/src/index.ts:73` onward protects all financial routers, but `spa/src/App.tsx` has no login/session flow and `spa/src/lib/api.ts:3` does not send CSRF tokens. Existing users receive 401/503 on reads, and an externally established session still receives 403 on mutations. Installing `react-plaid-link` does not implement linking. `spa/nginx.conf:12` still prohibits the frames/scripts needed by Link.

**Fix:** deliver login/logout/session restoration, provisioning/error screens, CSRF handling for JSON and file uploads, and expired-session recovery together with the guard. Then add Link/OAuth and CSP. Test the actual composed application, not only routers mounted without middleware. Verify secure cookies behind HTTPS and the documented local development setup. Rate limiting must use trusted proxy configuration rather than arbitrary client-supplied `X-Forwarded-For` (`middleware/auth.ts`, `loginClientKey`).

### F3 — P1: queued sync has no consumer, and SimpleFin ignores migration state

`api/src/services/sync-queue.service.ts` writes queue rows, but there is no worker code reading `SyncJob`, invoking `syncPage`, or publishing a Plaid batch. `worker/src/index.ts:17` still invokes the old importer directly. Import/backfill jobs never inspect `Account.ingestionState` or provider authority.

After the enum fix, Sync now can return 202 while remaining queued indefinitely. Marking an account MIGRATING or pausing its connection does not stop the existing SimpleFin jobs from changing that account.

**Fix:** implement the queue consumer and route all entry points through it; enforce per-account authority and migration state in both SimpleFin import and backfill. Do not activate migration until those guards work under concurrent execution.

### F4 — P1: balance normalization is reversed and applied twice

`shared/src/bank/normalization.ts:313` negates deposits but preserves the provider sign for liabilities, contrary to its intended contract. `shared/src/bank/plaid.ts:319` applies this helper, then `api/src/services/plaid-link.service.ts:774` applies it again when creating the account.

Executed synthetic examples:

| Provider balance | Adapter output | Account-create output | Required canonical balance |
| --- | --- | --- | --- |
| Checking +100 | -100 | +100 | +100 |
| Checking overdraft -100 | +100 | -100 | -100 |
| Credit-card debt +100 | +100 | +100 | -100 |
| Credit-card overpayment -100 | -100 | -100 | +100 |

The second conversion hides the deposit defect in one path; a future sync worker consuming the adapter output would receive the wrong sign. Available credit must also retain its own semantics rather than being treated as debt.

**Fix:** specify whether each adapter field is raw or canonical; normalize exactly once. Separate current debt balance from available credit. Correct auto/student loans being mapped to `MORTGAGE` at `normalization.ts:281`. Test adapter output and persisted account values together.

### F5 — P1: webhook receipt deduplication can lose valid updates

`api/src/routes/plaid.ts:146` returns 200 for any matching body hash. Receipt creation and job dispatch are separate operations. If dispatch fails after the receipt is inserted, the retry sees that receipt and never dispatches the work. Rejected requests also occupy the same unique body-hash namespace, so an earlier invalid signature can prevent a later valid delivery of those bytes from being processed. Identical notification bodies may also occur for distinct bank updates; a body hash is not a reliable permanent business-event identity.

**Fix:** commit verified receipt state and durable dispatch/outbox state together; resume RECEIVED-but-undispatched work; separate rejected-attempt telemetry from accepted delivery identity. Coalesce sync work while preserving another notification during an active sync. Test failure between receipt and dispatch, concurrent deliveries, invalid-then-valid delivery, and separate valid notifications with identical JSON. Also validate Plaid key expiry rather than treating a locally cached key TTL as provider validity.

### F6 — P1: account mappings are neither fully verified nor atomic

`api/src/services/plaid-link.service.ts:725` handles MAP without fetching authoritative inventory or checking that the supplied external account belongs to the Item and has compatible currency. It normalizes the external ID as human-readable text. Existing mappings can be reassigned without the conflict checks used for new mappings, leaving already-linked transaction relationships inconsistent. Multiple writes happen outside a transaction; CREATE inserts a local account before the source mapping, so a subsequent failure can leave an orphan/duplicate account.

The current conflict check rejects any other ACTIVE source, while the schema has no explicit active-source reference separate from a migration candidate. It therefore cannot cleanly represent a staged SimpleFin-to-Plaid mapping with exactly one authoritative source.

**Fix:** validate all requested mappings against one server-fetched inventory; preserve opaque IDs; enforce currency, ownership, and one-to-one rules. Make mapping/creation/authority changes transactional and idempotent. Introduce an explicit active source and migration candidate policy. Reassigning a source with existing history must use reconciliation, not a direct account-ID update.

### F7 — P1: provider failures and invalid financial records lose their meaning

`shared/src/bank/plaid.ts:110` reads Axios errors from `response.data.error`; Plaid supplies error fields directly in `response.data`. A synthetic `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION` response becomes `TRANSIENT / NETWORK` and loses its request ID. The required full-pagination restart and reconnect handling cannot work with that classification. Exceptions thrown by the normalizer are caught by the same wrapper and also become network failures.

`mapPlaidAccount` falls back to USD when currency is absent (`plaid.ts:333`), and `mapPlaidTransaction` replaces a missing required amount with zero (`plaid.ts:392`, `407`). Both outcomes were reproduced with fixtures. `mapSyncResponse` drops `transactions_update_status`, although the adapter advertises history readiness support.

**Fix:** parse the real Plaid error shape into allowlisted codes/messages; preserve normalization failures distinctly and retain enough staging data for quarantine. Reject missing required amount/identity/date, keep unknown currency explicit, preserve ISO versus unofficial currency, and expose history readiness. Test real-shaped SDK responses without live bank calls. Correct the misleading comment that SimpleFin shares Plaid's amount convention before integrating the shared helper into the existing importer.

### F8 — P1: migration bootstrap assumes an unverified legacy schema

`prisma/scripts/deploy-migrations.mjs:54` automatically marks the entire baseline applied whenever Prisma returns P3005. That error means a database is nonempty; it does not establish that every baseline table, column, index, and constraint already exists. On a partial legacy schema, missing baseline structures remain missing and subsequent migrations can fail or leave unusable application paths.

The working tree also deletes three existing migrations and replaces them with a broad baseline plus Plaid foundation migration. The new SQL uses many `IF NOT EXISTS` clauses, which do not validate that an existing object's definition matches the desired definition. No data backfill populates provider identities or derives USER/RULE ownership for existing categorized transactions; ownership currently defaults to NONE.

**Fix:** retain applied migration history unless using an explicit, verified migration-history consolidation procedure. Inspect and validate the actual legacy schema before resolving a baseline. Build a repeatable identity/category backfill. Prove upgrades against disposable copies of an empty database, a complete db-push database, existing migration history, and an intentionally partial legacy schema. Fail with instructions on unsupported drift; do not silently mark it migrated.

### F9 — P2: lifecycle recovery and concurrency remain incomplete

- Queue coalescing is a read-then-create without a database uniqueness/locking invariant (`sync-queue.service.ts:29–48`). Concurrent triggers can create duplicate active jobs, and the rerun flag can race job completion.
- Initial connection persistence and initial job creation are separate (`plaid-link.service.ts:541–586`). If enqueue fails, the attempt is already PERSISTED; retry returns early without repairing initial sync. Persisted-attempt retries also return only already mapped sources, so the initial mapping choices can disappear.
- Connection limit enforcement only counts existing connections during Link token creation. It reserves no slot and does not enforce the limit at completion; multiple attempts can exceed the configured trial guard.
- Exchange/update attempt state transitions lack consistent expiry and compare-and-set checks. Exchange cleanup must cover the unavoidable failure window after successful external exchange and before durable token persistence.
- Disconnect increments a version but does not enter a disconnecting/paused state before the external call. Authentication-required/consent errors are treated as proof of removal (`plaid-link.service.ts:968`), which can erase the token without confirmed Item removal.
- Environment checks are not centralized across all token-consuming paths, and key version metadata has no implemented keyring/rotation tooling.

**Fix:** use an explicit transactional state machine, unique/locked work reservations, recoverable outbox jobs, terminal-state checks, environment-scoped access, and provider-confirmed removal. Add failure injection around each external call/database boundary.

## Ordered implementation backlog

Each step below has an observable exit gate. Schema models alone do not satisfy a gate.

| Order | Work package and concrete changes | Completion criterion |
| --- | --- | --- |
| 1 | **Restore a working foundation.** Fix API compiler errors and queue enum runtime error. Add login/session/CSRF client support and trusted-proxy handling. Update the existing sync route contract/test. | Root build succeeds; API tests pass; the composed app allows login, reads, edits, file import, and logout; unauthorized and missing-CSRF requests are rejected. |
| 2 | **Make the data contract and upgrade safe.** Fix F4/F7; establish raw/canonical amount/balance types, history readiness, and validation failures. Resolve F8, add source/ownership backfill, and enforce one active account authority. | Synthetic mapping fixtures pass; migration matrix preserves local IDs, balances, user decisions, and relationships; repeated backfill is safe. |
| 3 | **Complete the durable ingestion backend.** Implement worker claiming, leases/heartbeats/fencing, retry/backoff, coalescing/rerun, complete pagination, staging, quarantine, and atomic cursor publication. Route SimpleFin and Plaid jobs through authority checks. Repair webhook receipt/dispatch semantics. | A queued Sandbox/synthetic sync reaches a terminal result and imports records; crash/retry/overlap tests show no duplicate writes, lost updates, or premature cursor advancement. Migrating accounts are untouched by SimpleFin. |
| 4 | **Complete linking and account management.** Fix verified/atomic mapping and lifecycle state machines; add Connect bank, OAuth resume, account choices, reconnect, pause/resume/disconnect, quota reservation, and deployed CSP. | Browser end-to-end flow links a Sandbox bank, maps/creates accounts once, executes initial sync, reconnects, and disconnects safely. Reload/retry does not lose inventory or create another Item. |
| 5 | **Implement reconciliation and lifecycle publication.** Match exact source IDs and pending predecessors; handle modifications/removals. Add cross-provider preview, one-to-one candidate decisions, confirmed cutover, audited undo, and version-aware quarantine replay. | A representative SimpleFin/file-import ledger migrates without duplicate totals or lost annotations; identical purchases and both sides of transfers survive; uncertain matches remain staged. |
| 6 | **Integrate downstream consumers.** Apply shared effective-transaction filters to lists/counts, dashboards, budgets, reports, categorization, and loan tracking. Repair derived records, protect reviewed categories, separate observed/derived snapshots, and add redacted AI/log projections. | All financial views agree; pending/removed/superseded/staged rows do not contaminate posted totals; corrections propagate without overwriting user decisions. |
| 7 | **Validate and roll out one connection.** Finish regression/migration/browser suites, document provisioning and recovery, verify Sandbox then one Production trial connection with an explicit reconciliation preview. | Initial history and at least one subsequent incremental update reconcile correctly; reconnect/retry and rollback procedures are demonstrated before remaining accounts migrate. |

The next implementation deliverable should be **work package 1**, followed immediately by the data-contract and migration fixes in package 2. Real account migration should wait for packages 3–6: the present schema and endpoints do not protect the visible ledger by themselves.

## Validation performed and limits

- Root `npm run build`: **failed in API**. Shared, SPA, and worker builds passed. The worker build passing does not imply Plaid execution exists.
- API tests: initial sandbox run could not bind the local test server. Rerun with the required permission: **132 passed, 1 failed**. Failure is the `/api/sync/trigger` route integration test (500 response; old test expects 200). These tests do not establish correctness of the new auth middleware or Plaid routes.
- Executed synthetic, network-free checks reproduced incorrect balance outputs, auto/student loans classified as mortgages, unknown currency changed to USD, missing amount changed to zero, and Plaid pagination mutation classified as NETWORK.
- Reviewed working-tree code and migration SQL. Did not apply migrations, access real bank accounts, call live Plaid APIs, or verify Production configuration.
- No dedicated automated tests for the new Plaid/auth/queue/reconciliation functionality were found. Add regression cases alongside each fix, plus PostgreSQL concurrency tests and browser tests at their respective milestones.

Build and test logs from this review are available in `/private/tmp/doughray-plaid-review-build.log` and `/private/tmp/doughray-plaid-review-api-tests-unrestricted.log` for the current machine/session.
