#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_DIR="$(mktemp -d /tmp/amore-flavor-rewards-pg.XXXXXX)"
PGDATA="$TEST_DIR/data"
PGPORT="${AMORE_TEST_PGPORT:-55439}"
PGLOG="$TEST_DIR/postgres.log"

cleanup() {
  if [[ -d "$PGDATA" ]]; then
    pg_ctl -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1 || true
  fi
  rm -rf "$TEST_DIR"
}
trap cleanup EXIT

command -v initdb >/dev/null || {
  echo "PostgreSQL initdb is required for this isolated test." >&2
  exit 1
}
command -v pg_ctl >/dev/null || {
  echo "PostgreSQL pg_ctl is required for this isolated test." >&2
  exit 1
}
command -v psql >/dev/null || {
  echo "PostgreSQL psql is required for this isolated test." >&2
  exit 1
}

initdb -D "$PGDATA" --username=postgres --auth-local=trust --auth-host=trust \
  --no-locale --encoding=UTF8 >/dev/null
if ! pg_ctl -D "$PGDATA" -l "$PGLOG" \
  -o "-h 127.0.0.1 -p $PGPORT -F -k $TEST_DIR" -w start >/dev/null; then
  cat "$PGLOG" >&2
  exit 1
fi

PSQL=(psql -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PGPORT" -U postgres -d postgres)

"${PSQL[@]}" -f "$ROOT_DIR/supabase/tests/local/flavor_rewards_bootstrap.sql"
"${PSQL[@]}" --single-transaction -f "$ROOT_DIR/supabase/migrations/20261116_amore_flavor_rewards.sql"
"${PSQL[@]}" --single-transaction -f "$ROOT_DIR/supabase/migrations/20261116_amore_flavor_rewards_security.sql"
"${PSQL[@]}" --single-transaction -f "$ROOT_DIR/supabase/migrations/20261116_amore_flavor_rewards_indexes.sql"

# Verify the forward-only migration fails closed, without deleting or changing
# existing ideas, when historical duplicate creators need manual review.
"${PSQL[@]}" -c "insert into auth.users (id, email) values ('90000000-0000-4000-8000-000000000001', 'duplicate@example.test')"
"${PSQL[@]}" -c "
  insert into public.flavor_ideas (creator_user_id, request_key, title, title_ar)
  values
    ('90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Old Idea One', 'فكرة قديمة ١'),
    ('90000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'Old Idea Two', 'فكرة قديمة ٢')
"
if "${PSQL[@]}" --single-transaction \
  -f "$ROOT_DIR/supabase/migrations/20261117090000_flavor_rewards_paid_order_schema.sql" \
  >"$TEST_DIR/duplicate-creator-migration.log" 2>&1; then
  echo "Expected the migration preflight to stop for duplicate historical creators." >&2
  exit 1
fi
duplicate_count="$("${PSQL[@]}" -Atc "
  select count(*) from public.flavor_ideas
  where creator_user_id = '90000000-0000-4000-8000-000000000001'
")"
claims_table="$("${PSQL[@]}" -Atc "select coalesce(to_regclass('public.flavor_creation_claims')::text, '')")"
if [[ "$duplicate_count" != "2" || -n "$claims_table" ]]; then
  echo "Migration preflight changed data or left a partial schema." >&2
  cat "$TEST_DIR/duplicate-creator-migration.log" >&2
  exit 1
fi
echo "PASS: duplicate-creator preflight preserved both historical rows and rolled back the draft."
"${PSQL[@]}" -c "
  delete from public.flavor_ideas
  where creator_user_id = '90000000-0000-4000-8000-000000000001';
  delete from auth.users where id = '90000000-0000-4000-8000-000000000001';
"

"${PSQL[@]}" --single-transaction -f "$ROOT_DIR/supabase/migrations/20261117090000_flavor_rewards_paid_order_schema.sql"
"${PSQL[@]}" --single-transaction -f "$ROOT_DIR/supabase/migrations/20261117091000_flavor_rewards_interest_guard.sql"
"${PSQL[@]}" --single-transaction -f "$ROOT_DIR/supabase/migrations/20261117092000_flavor_rewards_paid_order_security.sql"
"${PSQL[@]}" -f "$ROOT_DIR/supabase/tests/flavor_rewards_paid_orders.sql"

echo "Flavor Rewards migration tests passed on a disposable local PostgreSQL instance."
