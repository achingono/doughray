# Plaid and owner access setup

Doughray's Plaid integration requires the API, worker, and database schema from this change. Back up the existing database before deploying a schema update. Start with Plaid Sandbox and a disposable database before using real accounts.

Add these settings to the existing root `.env`; keep your existing Plaid client ID and secret private:

```dotenv
PLAID_ENV=sandbox
PLAID_COUNTRY_CODES=CA,US
PLAID_TRANSACTIONS_DAYS_REQUESTED=365
BANK_TOKEN_ENCRYPTION_KEY=<32-byte-base64-key>
BANK_TOKEN_ENCRYPTION_KEY_VERSION=1
OWNER_PASSWORD_HASH=<scrypt-hash>
```

Generate an encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Save it securely and back it up separately from the database. Changing or losing the key without re-encrypting the stored bank tokens prevents access to those connections.

To rotate a key, first back up the database and both keys securely. Stop **all** API and worker processes, including other instances; keep PostgreSQL running. From `code`, set `DATABASE_URL` to that database's host-accessible URL and set `BANK_TOKEN_ENCRYPTION_KEY` and `BANK_TOKEN_ENCRYPTION_KEY_VERSION` to the current values. Set `BANK_TOKEN_NEW_ENCRYPTION_KEY` to a different 32-byte key and `BANK_TOKEN_NEW_ENCRYPTION_KEY_VERSION` to a higher integer, then run `npm run bank:rotate-keys`. Supply secrets through environment variables rather than command-line arguments. The command rotates connection tokens and Link recovery tokens in one transaction and rolls back on any invalid or unexpected secret. After success, update the application's `BANK_TOKEN_ENCRYPTION_KEY` and `BANK_TOKEN_ENCRYPTION_KEY_VERSION` to the new values before restarting every API and worker process. Retain the previous key with the old database backup. Never restart an old-key process during or after rotation; it could write ciphertext with the wrong key.

To generate the owner password hash without placing the password in shell history, run from the repository root in Bash:

```bash
read -rs -p 'Owner password: ' doughray_password
printf '\n'
printf '%s' "$doughray_password" | node code/scripts/password-hash.mjs
unset doughray_password
```

Copy the resulting `scrypt:...` value into `OWNER_PASSWORD_HASH`. Use at least eight characters. In production, serve the app over HTTPS so the secure session cookie works. Configure `CORS_ORIGIN` to the exact frontend origin.

For institutions requiring OAuth, set `PLAID_REDIRECT_URI` to a registered HTTPS URL for this app, for example `https://your-host/plaid-oauth`. A publicly reachable HTTPS `PLAID_WEBHOOK_URL` ending in `/api/plaid/webhook` enables notifications; six-hour polling continues when no webhook is configured. Use `PLAID_ENV=production` and the corresponding secret only after Sandbox verification. Plaid's trial entitlement applies to Production Items; the app's connection limit is a local guard, not a billing or quota determination.

The API now fails closed if an existing database has no migration history: do not mark a baseline applied until a backup and schema comparison establish that it matches the baseline. Do not fall back to `prisma db push` after a migration failure. The migration matrix still needs verification against copies of real legacy installations.

For repeatable local checks, install the workspace dependencies and run `npm run test:plaid:db` from `code` with Docker available. This checks fresh and historical migration paths, rejects an incomplete unversioned schema, and runs the Plaid database integration tests in a disposable container. It does not use your configured database or call live Plaid APIs.

After signing in, open **Settings → Bank connections** and connect a bank. Map each bank account to the correct existing Doughray account or explicitly create a new account. Mapping an existing account pauses SimpleFin updates for it. Once Plaid has finished its historical pull, select **Review history**, decide whether each Plaid transaction matches an existing row or is new, and approve the switch. Never select the same existing transaction for two Plaid transactions. The worker publishes the approved snapshot before fetching later changes. Excluding an account discards its changes while the Item cursor advances; after that point it cannot be mapped on the same connection. Link it separately and reconcile its history instead.

The review initially offers at most 100 potential matches within three calendar days. **Search matches** finds same-account transactions with the exact amount and compatible currency on other dates; search by description or payee, or page through all eligible records. Select a result explicitly and check the date before approval. Legacy transactions without a recorded currency use the account currency. Different amounts and currencies cannot be matched. Use **Save draft** to retain partial decisions. If a selected search result changes, search again before approval.

An invalid provider record stops the batch without advancing the cursor; **Sync issues** lets the owner review a restricted record and retry after correcting fields. Repairs are applied only if the refetched bank record and normalization version still match; a newer bank value or removal takes precedence. Plaid amounts use positive values for expenses and negative values for income.

After a reviewed snapshot is published, **Undo switch** restores the pre-switch provider facts and pauses the affected Plaid account source, allowing SimpleFin to resume. Undo refuses when subsequent provider facts, account balances, linked records, or annotations on new transactions conflict with the recorded publication. User category changes on matched existing transactions are preserved. New Plaid-only rows are retained as removed history. Earlier switches without a complete undo journal cannot be automatically reversed; paused Plaid sources cannot yet be remapped in place.

Plaid updates and category changes reconcile derived loan-payment links. After changing or disabling a loan rule, run the loan tracker for that account to refresh existing history; the tracker removes links that no longer match as well as adding new ones.

Keep SimpleFin configured for accounts that have not yet migrated. Undo rejects later conflicts; retain your database backup and verify results before migrating additional institutions. Unmapped accounts in a connected Item prevent transaction publication until mapped or explicitly excluded. Sandbox transaction retrieval and incremental sync were exercised in a disposable environment. The user completed a Sandbox OAuth popup, but the resulting Item and sync were not independently verified before the temporary environment was removed. A real Production trial connection has not been validated end to end.

Disconnecting while a migration review is still open restores SimpleFin ingestion for that account. Disconnecting after approval pauses ingestion for the affected account; it does not automatically resume SimpleFin, because that could duplicate Plaid-only transactions.
