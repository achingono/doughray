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

Generate an encryption key with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Save it securely and back it up separately from the database. Changing or losing the key without re-encrypting the stored bank tokens prevents access to those connections. Key rotation tooling is not yet implemented.

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

After signing in, open **Settings → Bank connections** and connect a bank. Map each bank account to the correct existing Doughray account or explicitly create a new account. Mapping an existing account pauses SimpleFin updates for it. Once Plaid has finished its historical pull, select **Review history**, decide whether each Plaid transaction matches an existing row or is new, and approve the switch. Never select the same existing transaction for two Plaid transactions. The worker publishes the approved snapshot before fetching later changes.

The review offers at most 100 potential matches within three calendar days. If a known match is missing, leave that review unfinished instead of marking it new. Match decisions are stored when the whole review is approved; partially completed browser selections are not saved. An invalid provider record stops the batch without advancing the cursor; a quarantine repair interface is not yet available.

Keep SimpleFin configured for accounts that have not yet migrated. Reconciliation approval, processed provider corrections, and reconstructed reports do not yet have a complete post-sync undo workflow; retain your database backup and verify results before migrating additional institutions. Unmapped accounts in a connected Item prevent transaction publication until mapped. Sandbox Link/OAuth and a real Production trial connection have not yet been validated end to end.

Disconnecting while a migration review is still open restores SimpleFin ingestion for that account. Disconnecting after approval pauses ingestion for the affected account; it does not automatically resume SimpleFin, because that could duplicate Plaid-only transactions.
