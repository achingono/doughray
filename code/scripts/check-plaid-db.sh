#!/usr/bin/env bash
# Validate migrations and Plaid publication only in a disposable PostgreSQL database.
# Requires Docker, rg and installed workspace dependencies. Never uses the user's DB.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

container_name="doughray-plaid-check-$$"
partial_log="$(mktemp)"
cleanup() {
  docker stop "$container_name" >/dev/null 2>&1 || true
  rm -f "$partial_log"
}
trap cleanup EXIT
docker run --rm -d --name "$container_name" \
  -e POSTGRES_PASSWORD=validation -e POSTGRES_USER=validation -e POSTGRES_DB=validation \
  -p 127.0.0.1::5432 postgres:16-alpine >/dev/null
ready=false
for attempt in {1..30}; do
  if docker exec "$container_name" pg_isready -U validation -d validation >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != true ]; then
  echo 'Disposable PostgreSQL did not become ready.' >&2
  exit 1
fi
port="$(docker port "$container_name" 5432/tcp | sed 's/.*://')"
export DATABASE_URL="postgresql://validation:validation@127.0.0.1:${port}/validation"

# Fresh database must reach the declared Prisma schema.
node prisma/scripts/deploy-migrations.mjs
npx --no-install prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code

# A nonempty unversioned schema must fail closed and preserve existing data.
docker exec "$container_name" createdb -U validation partial
docker exec "$container_name" psql -U validation -d partial -c 'CREATE TABLE sentinel (id integer); INSERT INTO sentinel VALUES (7);' >/dev/null
partial_url="postgresql://validation:validation@127.0.0.1:${port}/partial"
if DATABASE_URL="$partial_url" node prisma/scripts/deploy-migrations.mjs >"$partial_log" 2>&1; then
  echo 'Unexpected success on partial legacy database.' >&2
  exit 1
fi
if ! rg -q 'Existing database has no migration history' "$partial_log"; then
  cat "$partial_log" >&2
  exit 1
fi
docker exec "$container_name" psql -U validation -d partial -Atc 'SELECT id FROM sentinel' | rg -x '7' >/dev/null

# Simulate the application's historical migration records without a baseline record.
docker exec "$container_name" createdb -U validation legacy
docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U validation -d legacy < prisma/migrations/20260101000000_baseline/migration.sql >/dev/null
legacy_url="postgresql://validation:validation@127.0.0.1:${port}/legacy"
for migration in 20260423161500_add_account_loan_details 20260424123000_add_account_registered_and_credit_card_details 20260424140000_add_asset_account_link; do
  docker exec -i "$container_name" psql -v ON_ERROR_STOP=1 -U validation -d legacy < "prisma/migrations/$migration/migration.sql" >/dev/null
  DATABASE_URL="$legacy_url" npx --no-install prisma migrate resolve --applied "$migration" --schema=prisma/schema.prisma >/dev/null
done
DATABASE_URL="$legacy_url" node prisma/scripts/deploy-migrations.mjs
npx --no-install prisma migrate diff --from-url "$legacy_url" --to-schema-datamodel prisma/schema.prisma --exit-code

cd worker
RUN_PLAID_DB_TESTS=1 ../node_modules/.bin/vitest run --config vitest.config.ts src/jobs/plaid-db.integration.test.ts
