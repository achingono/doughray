# Plaid implementation plan

Prepared October 28, 2026. Scope: a complete Plaid Transactions integration for Doughray, from linking and connection maintenance through historical import, incremental synchronization, sanitization, reconciliation, and migration from SimpleFin. Real bank connections use Plaid's Production environment with the user's trial credentials; automated development uses Sandbox. The trial's connection allowance is an account entitlement, not a separate API environment.

This plan covers accounts, balances, and transactions available through the Transactions integration. Investment transactions/holdings, Liabilities, Identity, Auth, payments, and other separately enabled Plaid products would require additional product-specific work. Existing manually entered investment and loan metadata must survive this migration.

## Current implementation and gaps

| Area | Current behavior | Required change |
| --- | --- | --- |
| Retrieval | `code/worker/src/lib/simplefin.ts` invokes SimpleFin CLI; import and backfill jobs directly depend on it. | Shared provider contract with a Plaid adapter and provider-specific cursors/history handling. |
| Identity | `Account.externalId` and `Transaction.externalId` are globally unique source identifiers. | Separate stable local records from provider identities; allow both providers to reference one local record. |
| Transaction lifecycle | Imports upsert amounts and descriptions; no pending, replacement, or removal state. | Explicit source lifecycle, pending-to-posted reconciliation, audited removals, and consistent reporting filters. |
| Manual sync | `routes/sync.ts` returns a queued response without queuing work. A separate service only creates a running log. | Persist actual work and have the worker execute it; status must track that work. |
| Scheduling | Worker schedules SimpleFin imports/backfills, and performs imports and snapshot reconstruction at startup. | Queue imports by connection, respect account migration state, and gate derived-data work on committed data. |
| File imports | Fingerprint deduplication uses date/amount/text and can collapse identical purchases. | Keep source identity authoritative; use one-to-one matching for cross-source reconciliation and preserve multiplicity. |
| Sanitization | Shared payee normalization drops digits/non-ASCII letters and is used for categorization. | Preserve readable source text and use a separate conservative matching representation. |
| UI | Settings displays SimpleFin status only. | Bank linking, connection health, account mapping, history progress, reconciliation, and disconnection. |
| Browser policy | SPA Nginx and API policies prohibit external frames/scripts/connections. | Allow documented Plaid Link origins in the relevant directives and test deployed headers. |
| Configuration | `.env` contains `PLAID_CLIENT_ID` and `PLAID_CLIENT_SECRET`; Compose forwards neither. | Validate and forward configuration to API/worker only. |
| Access control | API entry point has no application authentication middleware. | Establish an owner session and protect financial and connection-management endpoints. |

Existing working-tree changes, including `code/worker/src/index.ts`, must be incorporated without overwriting unrelated work.

## Design decisions

- Keep local account and transaction IDs stable. Provider IDs are opaque, case-sensitive references and must never be normalized or substituted for local IDs.
- Support SimpleFin and Plaid during migration, with one authoritative provider per local account. Imported history from other sources remains attached.
- Route scheduled, manual, startup, and webhook-triggered sync through a PostgreSQL-backed queue. Use the existing database rather than adding a separate queue service.
- Fetch a complete Plaid update into staging before publishing it. Commit ledger updates, mappings, audit records, follow-up work, and the final cursor atomically.
- Keep financial facts separate from user choices. Provider updates can correct amounts/dates/status while preserving user categories, review decisions, and local relationships.
- Use deterministic reconciliation. AI categorization must never decide transaction identity, amounts, account mappings, or duplicate merges.
- Default financial totals to posted, active, reconciled transactions. Show pending transactions separately. Staged migration candidates never enter totals.

## 1. Configuration, authentication, and provider foundations

Add the official Plaid Node SDK to the shared server package and `react-plaid-link` to the SPA. Keep Plaid credentials and token operations out of browser bundles. Add shared typed adapter interfaces for account retrieval, transaction changes, capabilities, health, and sanitization; keep Plaid-specific operations such as Link and Item maintenance explicit.

Validate these settings on startup, with clear configuration status that reveals no secret values:

| Setting | Purpose/default |
| --- | --- |
| `PLAID_CLIENT_ID`, `PLAID_CLIENT_SECRET` | Existing credential names; map the secret to the SDK's secret configuration. |
| `PLAID_ENV` | Explicit `sandbox` or `production`; fail closed for invalid values and keep environments isolated. |
| `PLAID_COUNTRY_CODES` | Configurable; start with `CA,US` for the intended Canadian/US account coverage. |
| `PLAID_REDIRECT_URI` | Registered OAuth return URL for the deployed frontend. |
| `PLAID_WEBHOOK_URL` | Public HTTPS URL for the dedicated verified webhook route; optional for local polling-only use. |
| `PLAID_TRANSACTIONS_DAYS_REQUESTED` | Default 365; validate against current Plaid limits and send during Link initialization. Actual history depends on the institution. |
| `BANK_TOKEN_ENCRYPTION_KEY`, key version | Dedicated server encryption key, separate from Plaid credentials; shared by API and worker. |
| `PLAID_REFRESH_ENABLED` | Default false; enable on-demand bank extraction only when the account entitlement supports it. |
| `PLAID_CONNECTION_LIMIT` | Optional deployment guard, initially 10 for this trial; an app-side guard is not authoritative billing/quota information. |

Update Compose, `.env.example`, local startup instructions, and deployment configuration. Require successful schema migrations before starting the worker; remove the deployment fallback that silently substitutes `prisma db push` for a failed migration for this rollout.

Implement a single-owner authenticated session for this household deployment: provision a password hash through server configuration, use server-side sessions and secure HttpOnly cookies, rate-limit login, and protect state-changing requests against CSRF. Associate Link attempts with the owner/session. Apply access checks consistently to financial APIs; leave only health, login, and the cryptographically verified webhook entry point outside the session requirement. No browser-shipped shared secret. Keep database/API container ports private in deployment, exposing the frontend and webhook through HTTPS.

**Acceptance:** both environments can initialize independently; missing/invalid secrets disable linking clearly; unauthenticated requests cannot link, read connections, or trigger mutations; no credentials appear in assets, errors, or logs.

## 2. Add durable identities, staging, and audit models

Use additive Prisma migrations first and retain legacy `externalId` fields while existing call sites transition. New canonical records can use generated internal compatibility values until those legacy fields are retired; do not replace existing values during migration.

| Model/change | Responsibilities and constraints |
| --- | --- |
| `BankConnection` | Owner, provider, environment, external Item ID, encrypted access token with nonce/authentication tag/key version, institution, health, history readiness, transaction cursor, version, and last-success/error metadata. Unique provider/environment/Item identity. |
| `LinkAttempt` | Session-bound expiring attempt, mode, target connection, completion state, and idempotency metadata. Retain sensitive temporary state encrypted only as long as needed for recovery. |
| `AccountSource` | Connection + external account ID unique; maps to a local Account, with mask, provider type/subtype, currency, presence/consent status, and source timestamps. |
| Account migration state | Active source, candidate source, and `ACTIVE`, `MIGRATING`, or `PAUSED` ingestion state. Enforce one authority per local account. |
| `TransactionSource` | Unique AccountSource + external transaction ID; maps to canonical Transaction; retains source status, pending predecessor ID, observed facts, and source revision/batch. Multiple source references may map to one canonical transaction. |
| Canonical Transaction additions | `PENDING`, `POSTED`, `REMOVED`, or `SUPERSEDED` lifecycle; replacement reference; effective currency/date metadata; provenance for category/review ownership and user overrides. Backfill existing records as posted. |
| `SyncJob` and expanded `SyncLog` | Actual durable work, connection, trigger, attempts, next-run time, lease/heartbeat, rerun flag, safe error/request ID, and separate fetched/added/modified/removed/matched/quarantined counts. |
| `SyncBatch`/staged changes | Starting/final cursor, ordered changes and staging state. Persist only necessary provider facts, encrypted if retaining source payloads. Incomplete batches are never visible to financial queries. |
| `ReconciliationCase` and audit entries | Candidates, evidence, decision, before/after mappings, transaction versions, actor, timestamp, and reversal metadata. |
| Quarantine records | Validation reason, minimum repairable source payload, connection/batch identity, and replay status. Restricted access and bounded retention. |
| Verified webhook receipts | Replay/deduplication metadata and durable dispatch state; no token-bearing payload logging. |

Seed mappings for known SimpleFin IDs using verified connection data and retain file-import provenance. Flag uncertain legacy sources rather than guessing solely from ID patterns. Use authenticated encryption (for example AES-256-GCM with unique nonces and connection/environment as associated data), rotation tooling, and explicit ORM selections to prevent accidental token serialization.

**Acceptance:** migration of a representative database preserves row counts, balances, local IDs, categories, goal/asset links, loan metadata, and loan transaction relationships. Re-running the backfill is safe.

## 3. Implement linking and the connection lifecycle

Settings gains a Bank Connections area with Connect bank, institution/account list, connection state, history readiness, last successful sync, Sync now, Reconnect, Manage accounts, Pause, and Disconnect.

The initial flow is: create a session-bound Link attempt → backend calls `/link/token/create` with `transactions`, configured countries/history/redirect/webhook → SPA opens Link → backend exchanges the public token through `/item/public_token/exchange` → persist the encrypted token and Item → fetch authoritative accounts through `/accounts/get` → display account mapping → initialize transaction sync immediately into staging.

Treat Link metadata as a UI hint. Verify account membership and institution details using server-side Plaid responses. Let the owner map each selected account to an existing Doughray account or explicitly create a new one. Suggest matches using institution, mask, type/subtype, and currency; names/masks alone cannot establish identity. Keep unmapped accounts and their changes staged so no history is lost while mapping is pending.

Implement OAuth return/resume using the same Link attempt, including reload/cancel/expired-token handling. Update SPA routing and CSP according to Plaid's current web integration requirements, including effective `script-src-elem`, frame, and connection policies.

Use Link update mode for existing Items that require reauthentication or additional account consent. On completion, refetch Item/account health and enqueue sync; do not assume update mode creates a new public token or Item. Handle duplicate completion requests idempotently, and track failures between token exchange and database persistence so an orphaned Item can be recovered or removed. Discourage duplicate institution connections, allow legitimate separate logins, and enforce any configured trial guard with concurrency-safe reservation. Do not promise that disconnecting an Item restores trial allowance.

Pause stops local ingestion. Disconnect fences in-flight work, calls `/item/remove`, tracks retriable failure, and deletes the stored access token after confirmed removal. Retain local history and audit data by default; historical-data deletion is a separate explicit action. Handle consent revocation, new/removed accounts, institution errors, and account-ID changes without automatically deleting accounts or histories.

**Acceptance:** initial Link, OAuth redirect, cancellation, duplicate completion, reconnect, account consent updates, and disconnect all work; existing accounts keep their local IDs and metadata.

## 4. Implement durable synchronization and verified webhooks

1. Manual sync returns `202` and a persisted job ID. Cron/startup/webhook handlers enqueue the same job type. Coalesce requests by connection, and set a durable rerun flag when a notification arrives during a running job.
2. Worker claims jobs with database locking and an expiring renewable lease. Use fencing/version checks at commit so a crashed or expired worker cannot publish after a replacement worker or disconnect. Retry timeouts/rate limits/transient failures with bounded exponential backoff and jitter; route authentication/consent errors to reconnect.
3. Read the committed cursor and connection version, then retrieve `/transactions/sync` pages until `has_more` is false. Never hold a database transaction open during network calls. Stage complete changes and preserve the batch's original cursor.
4. On `TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION`, discard that attempt's staged pages and restart from the original cursor. On other failures, leave the committed cursor unchanged. Repeated failures produce an actionable failed job, not an infinite loop.
5. Validate and normalize records, then apply lifecycle and reconciliation rules. Publish the complete batch and final cursor in one database transaction using expected-version checks. Malformed records must either abort the batch or be durably quarantined in that same commit; nothing is silently skipped. A quarantined batch is shown as partial/degraded, with replay required.
6. Always make an initial sync call after creating the Item, even when no data is ready; this initializes sync webhooks. Track `NOT_READY`, initial completion, and historical completion separately. Empty results do not prove that history is complete. Never initialize migration using `cursor: "now"`, which would omit historical data needed for reconciliation.
7. Fetch account inventory/balances through `/accounts/get`; sync response accounts may omit accounts without transactions. Record retrieval freshness separately from bank-provided timestamps, tolerate nullable balances, and preserve the last usable value with a stale marker.
8. After successful publication, enqueue categorization/rules and derived-data maintenance transactionally. Scheduled six-hour polling remains a fallback when a webhook is missed or local development cannot receive public callbacks.

The webhook route must capture exact raw request bytes before JSON parsing, verify `Plaid-Verification` JWTs using Plaid's verification keys, enforce ES256/key validity and issued-at age per the documentation, and compare the body SHA-256 with the signed claim. Reject invalid/replayed requests; deduplicate valid retries without losing work. Persist the event/job before returning success. Handle `SYNC_UPDATES_AVAILABLE` and relevant Item health/consent/account events; do not mix legacy transaction webhook workflows into cursor-based sync.

“Sync now” pulls changes Plaid already has. An optional, separately labeled “Refresh from bank” calls `/transactions/refresh` only if enabled/supported, waits for resulting updates, and reports unsupported or rate-limited responses. Neither action promises instant bank refresh.

**Acceptance:** retries, duplicate/out-of-order webhooks, simultaneous cron/manual requests, pagination mutation, worker crashes, lease expiry, and disconnect races cannot duplicate records or advance a cursor past unrecorded changes. Failure for one connection does not stop other connections.

## 5. Sanitize and normalize transaction data

Build a versioned, deterministic normalization pipeline shared by ingestion paths, with provider-specific input adapters.

| Data | Rule |
| --- | --- |
| Money | Convert via decimal arithmetic; Doughray inflows are positive and outflows negative, so `amount = -Plaid.amount`. Do not use floating-point rounding for identity comparisons. Validate precision/range against the database; quarantine unsupported precision rather than silently losing value. |
| Balances | Keep deposits signed, including overdrafts; convert positive credit/loan debt to Doughray's negative-liability representation. Preserve overpayment semantics. Do not sum transaction history to invent a current balance. |
| Currency | Retain ISO/unofficial currency information. Do not silently default unknown currencies to USD or match transactions across currencies. Guard existing currency totals from unsupported mixtures. |
| Dates | Preserve bank calendar date as a date-only value, authorization date separately, and optional timestamps. Bridge existing `posted` fields without timezone day shifts; test Toronto DST boundaries. |
| Text | Preserve case, meaningful numbers, accents, and Unicode in readable fields. Normalize Unicode, trim, collapse whitespace, remove control characters, and bound lengths. Render as text. Keep provider facts separate from future user edits. |
| Matching | Create conservative, versioned matching keys from original validated fields. Never use the existing lossy `normalizePayee` output or a redacted display string as a unique transaction identifier. |
| Account types | Explicit Plaid type/subtype mapping; unknown values become `OTHER` with review, not name-based debt inference. |
| Categories | Manual decisions and account/global category rules take priority. Store Plaid personal-finance category/confidence as source metadata; map known taxonomy versions without replacing reviewed categories. Use AI only as an optional fallback. |
| Missing/invalid fields | Treat valid nullable fields as unknown. Quarantine invalid required identity/date/amount fields with a repair reason. Never synthesize today's date, zero amount, or a fake account. |

Create distinct allowlisted DTOs for browser responses, operational logs, and AI inputs. Log connection/job IDs, counts, error codes, and Plaid request IDs; redact credentials, authorization headers, account/routing numbers, and token-bearing SDK error objects. AI inputs receive only needed normalized/redacted transaction fields and temporary batch identifiers, with no raw Plaid payloads, Item IDs, account masks, or access tokens. Treat transaction descriptions as untrusted data and validate category assignments against both the submitted batch and allowed categories. Recheck review/category state at write time to avoid overwriting a user decision made while categorization was running.

Restricted provider facts can retain information needed for reconciliation; privacy redaction must not destroy the evidence used to distinguish transactions. Apply retention cleanup to staged/quarantined payloads only after publication, resolution, or expiration rules preserve replay/audit requirements.

**Acceptance:** fixtures cover credits/refunds, debt/overpayments, null balances, non-ASCII merchants, identical purchases, very long/control-character strings, DST/date-only values, unsupported precision/currency, secret-bearing errors, and adversarial descriptions.

## 6. Reconcile lifecycle changes and SimpleFin history

Use two distinct reconciliation paths: exact provider lifecycle updates, and reviewed cross-provider migration.

For normal Plaid sync, resolve exact source IDs first. Added records replay safely; modified records update provider facts on the existing canonical transaction. When a posted record has `pending_transaction_id`, attach the posted source to the existing pending canonical record, retaining its local identity and user decisions. Handle the associated pending removal across pages/batches, changed amount/date, and a missing pending record. If Plaid supplies no predecessor, do not auto-merge on merchant/amount similarity. Removed source records become audited tombstones; remove a canonical record from effective totals only under the authoritative-source policy. Removal of a historical SimpleFin alias must not erase an active Plaid record.

For migration, use this controlled sequence per selected account group:

1. Back up the database and record a migration batch/connection/account manifest. Fence and pause SimpleFin import and backfill for those accounts; other accounts continue syncing.
2. Confirm account mappings. Fetch Plaid history into staging while leaving the existing visible ledger authoritative. Wait for historical readiness where available and explicitly record the observed overlap/coverage limits.
3. Produce a dry-run reconciliation report: exact aliases already known, likely matches, conflicting fields, ambiguous repeated purchases, proposed new transactions, balances, per-currency/month counts and totals, and unchanged older history.
4. Match only within the same mapped local account and currency using exact decimal amount and bounded date/text evidence. Default date tolerance is three calendar days for suggestions. Require one-to-one candidate assignment and preserve multiplicity. Cross-provider fuzzy matches require review; only previously verified identity aliases are applied automatically.
5. Review allows “same transaction,” “keep both,” “new transaction,” or defer. Same-transaction decisions attach another source identity to the existing canonical record and preserve its ID, category, review flag, and relationships. Monetary/date conflicts display both versions; accepted provider facts update the canonical record with an audit entry.
6. Commit a version-checked reconciliation plan and switch the account's active source atomically. All remaining candidate rows must have a decision before cutover; the existing ledger remains visible while decisions are deferred. Import confirmed new records and retain older SimpleFin/file history outside Plaid's available window.
7. Process subsequent Plaid changes by their saved cursor and source IDs. Keep SimpleFin disabled for migrated accounts, including backfill and startup paths. Reconcile later file imports through the same source-mapping rules.

Do not deduplicate merely because date, amount, and merchant match: two identical purchases may both be real. Do not match across accounts: both sides of a transfer or card payment must remain. Optional transfer-pair metadata may connect those rows for reporting without merging them. Missing history is not evidence that a transaction was deleted; only explicit provider removals change source lifecycle.

Quarantine replay and reversal are version-aware: an old repaired record cannot overwrite a newer provider change or removal. Record audit provenance and enqueue dependent repairs. Undo a merge by restoring source mappings and user metadata under version checks; conflicts created by subsequent edits require review.

**Acceptance:** a seeded SimpleFin/file-import ledger can move to Plaid with stable IDs and no double counting; repeated purchases survive; pending-to-posted preserves edits; removed or corrected records have an auditable effect; reconnect/account-ID changes trigger mapping review rather than duplicate account creation.

## 7. Integrate reporting, reconciliation UI, and operational status

Add shared queries for effective transactions and apply them to transaction lists/filter counts, dashboard/trends, budgets, reports/PFS, AI analysis, categorization, loan tracking, and snapshot reconstruction. Pending, removed, superseded, and staged transactions must not silently enter posted spending totals.

Update existing derived loan transactions when a source transaction changes amount/date/category or becomes inactive; the current tracker only appends missing links. Recompute affected derived figures after committed reconciliation. Mark stored reports stale and offer regeneration. Distinguish observed balance snapshots from reconstructed history; regenerate only derived snapshots with adequate coverage, and display limitations when history is incomplete. Avoid the current blanket startup reconstruction overwriting observed history during migration.

The reconciliation screen shows source account, transaction evidence side by side, proposed action, confidence/reason, totals impact, and decision history. Support explicit bulk acceptance of reviewed suggestions and undo where versions allow it. Show pending, partial sync/quarantine, initial history loading, historical completion, stale balances, reconnect needed, and provider errors as distinct states.

**Acceptance:** transaction totals, budget totals, loan tracking, and generated reports agree for the same effective ledger; no account is double-counted during migration; status reflects persisted work rather than a button timer.

## Proposed API surface

All management routes require the owner session and appropriate mutation protection. Return safe DTOs and opaque local IDs; never return access tokens.

| Route | Purpose |
| --- | --- |
| `POST /api/plaid/link-token` | Create a new or update-mode Link attempt. |
| `POST /api/plaid/exchange` | Complete initial linking idempotently. |
| `POST /api/plaid/connections/:id/link-complete` | Complete update mode, refetch health/accounts, and enqueue work. |
| `GET /api/bank-connections` | List connection/account health, readiness, and safe configuration state. |
| `POST /api/bank-connections/:id/account-mappings` | Stage/confirm local account mappings. |
| `POST /api/bank-connections/:id/sync` | Enqueue actual sync and return job ID. |
| `POST /api/bank-connections/:id/refresh` | Optional bank refresh, with capability/rate-limit checks. |
| `POST /api/bank-connections/:id/pause` and `/resume` | Change local ingestion state. |
| `DELETE /api/bank-connections/:id` | Disconnect via a tracked, retriable removal operation. |
| `POST /api/plaid/webhook` | Verify raw signed payload and durably dispatch work. |
| `GET /api/sync/jobs/:id` | Poll real progress/results; preserve existing sync history compatibility. |
| `POST /api/reconciliations/preview` | Create a versioned migration/reconciliation preview. |
| `GET /api/reconciliations/:id` | Read candidates, decisions, coverage, and totals. |
| `POST /api/reconciliations/:id/decisions` and `/commit` | Save review decisions, then atomically apply/cut over. |
| `POST /api/reconciliations/:id/undo` | Apply a version-checked audited reversal. |
| `POST /api/sync/quarantine/:id/replay` | Retry a repaired record without overwriting newer facts. |

## Delivery order and validation gates

| Milestone | Deliverable | Exit gate |
| --- | --- | --- |
| 1 | Configuration, owner access, provider contracts, additive schema, identity backfill | Migration on a database copy preserves existing data and SimpleFin behavior. |
| 2 | Plaid Link, OAuth, encrypted tokens, account mapping, reconnect/disconnect | Sandbox lifecycle tests and browser checks pass with deployed CSP. |
| 3 | Normalization, durable jobs, staging, complete cursor sync, verified webhooks | Fault-injection tests establish idempotency, cursor safety, lease fencing, and data validation. |
| 4 | Pending/removal handling, cross-source reconciliation, preview/commit/undo UI | Migration fixtures retain multiplicity, reviewed categories, and local relationships. |
| 5 | Reporting filters, loan/snapshot repair, safe AI DTOs, connection status | API/worker/SPA tests and end-to-end totals agree. |
| 6 | Controlled Production trial rollout and runbook | One bank connection reconciled and observed successfully before remaining accounts migrate. |

Use unit tests for mapping, money/date/text rules, matching, and category precedence; real PostgreSQL integration tests for unique constraints, atomic commits, locks, crash recovery, and migrations; mocked Plaid responses for deterministic pagination/lifecycle failures; Sandbox tests for actual API/Link contracts; and browser end-to-end tests for OAuth, mapping, reconciliation, reconnect, and effective CSP. Verify both frontend and worker paths enforce the same lifecycle rules.

Required regression scenarios include: an empty first sync followed by historical completion; mutation on a later page; a crash before/after database commit; concurrent manual/webhook/cron requests; revocation during a job; repeated same-amount purchases; both sides of a transfer; pending removal and posted addition in different batches; missing predecessor IDs; correction of an already reviewed transaction; a quarantined record repaired after a newer removal; wrong-environment tokens; webhook signature/body tampering; and re-linking an account with a changed provider ID.

Run repository build and relevant API/worker/SPA tests, then end-to-end and migration tests. Use sanitized fixtures, never real credentials or production bank payloads committed to the repository.

## Production cutover and rollback

The owner completes bank consent in Plaid Link. Use the existing trial credentials with `PLAID_ENV=production`, the registered OAuth URL, and a verified HTTPS webhook endpoint (or explicitly configured polling-only operation). Link one institution first, map accounts, review staged history, commit reconciliation, and observe at least one subsequent incremental update. Compare balances at equivalent freshness and transaction totals over known overlapping coverage; investigate differences without fabricating adjustments to force equality.

Migrate remaining accounts only after the first connection passes. Keep SimpleFin credentials and aliases available during the transition, but prohibit simultaneous authoritative writes to a migrated account. Update README/configuration/deployment/worker documentation with setup, connection limits, history expectations, error recovery, key rotation, and backup/restore instructions.

Rollback pauses/fences Plaid ingestion, preserves the expanded schema and all committed history, and uses the reconciliation audit to reverse selected mappings when safe. Re-enabling SimpleFin requires a new staged overlap reconciliation; blindly turning the old importer back on would duplicate Plaid-only rows. Database snapshot restoration is a disaster-recovery option with a defined data-loss window, not the normal provider rollback path.

Completion means a user can link a real bank under the trial, migrate existing accounts without duplicate totals, receive automatic transaction changes, review uncertain matches, reconnect/disconnect, and recover from interruptions while preserving manual classifications and historical relationships.

## Reference documentation

Reviewed against Plaid documentation while preparing this plan:

- [Plaid Link](https://plaid.com/docs/link/)
- [Transactions Sync integration and pagination](https://plaid.com/docs/transactions/sync-migration/)
- [Transactions API: amounts, pending references, history, and refresh](https://plaid.com/docs/api/products/transactions/)
- [Webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/)
- [Quickstart and environment setup](https://plaid.com/docs/quickstart/)

During implementation, pin SDK/API and personal-finance category taxonomy versions and validate the precise Link CSP/OAuth requirements and trial product entitlements against the current dashboard and documentation.
