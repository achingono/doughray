#!/usr/bin/env node
/**
 * Deployment migration bootstrap for Doughray.
 *
 * Replaces the old `prisma migrate deploy || prisma db push` fallback, which
 * silently substituted schema synchronization for failed migrations.
 *
 * Handles three start states:
 *  1. Empty database  -> apply all migrations normally.
 *  2. An existing schema without migration history -> fail closed; a baseline
 *     must only be recorded after the actual schema has been verified.
 *  3. Normal history  -> plain `prisma migrate deploy`.
 *
 * Never falls back to `prisma db push`. Retries while another container holds
 * the Prisma advisory migration lock so concurrent api/worker start is safe.
 */
import { spawnSync } from 'node:child_process';

const SCHEMA_ARG = ['--schema=prisma/schema.prisma'];
const MAX_ATTEMPTS = 30;
const RETRY_DELAY_MS = 4000;

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

function runPrisma(args) {
  const result = spawnSync('npx', ['--no-install', 'prisma', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  return { ok: result.status === 0, output, status: result.status };
}

function isLockContention(output) {
  return /database is locked|another instance of Prisma CLI|migration is being run|advisory lock/i.test(output);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const deploy = runPrisma(['migrate', 'deploy', ...SCHEMA_ARG]);
    if (deploy.ok) {
      console.log(`${GREEN}[migrate] Migrations applied successfully.${RESET}`);
      process.exit(0);
    }

    if (/P3005/.test(deploy.output)) {
      console.error(`${RED}[migrate] Existing database has no migration history. Verify its schema and back it up before recording a baseline; no changes were made.${RESET}`);
      process.exit(1);
    }

    if (isLockContention(deploy.output)) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }

    console.error(`${RED}[migrate] Migration deploy failed (attempt ${attempt}/${MAX_ATTEMPTS}):${RESET}\n${deploy.output}`);
    if (deploy.status === 1) {
      process.exit(1);
    }
    await sleep(RETRY_DELAY_MS);
  }

  console.error(`${RED}[migrate] Timed out waiting for database migrations.${RESET}`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[migrate] Unexpected failure:', err);
  process.exit(1);
});
