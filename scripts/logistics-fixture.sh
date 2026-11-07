#!/usr/bin/env bash
# Local-only UI fixture for per-location logistics. Uses a disposable DB on the local test Postgres (never LIVE).
#   scripts/logistics-fixture.sh start          # create DB lm_fixture (if missing) + run the dev server on :4399 (log /tmp/lm-fixture.log)
#   scripts/logistics-fixture.sh seed NAME      # stop, give NAME a factory, a city home, 300 copper ore + 40 iron bars at the
#                                               # factory, 2 lake fish, 100k chips, then start again
#   scripts/logistics-fixture.sh stop
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=${LM_PG:-postgresql://mayor_test@127.0.0.1:55439}; DB=lm_fixture; URL="$BASE/$DB"; PORT=${LM_PORT:-4399}
case "$(printf %s "$BASE" | sed -E 's#^[a-z]+://([^@]*@)?([^:/]+).*#\2#')" in 127.0.0.1|localhost) ;; *) echo "local DB only" >&2; exit 1;; esac
pidf=/tmp/lm-fixture.pid
stop() { if [ -f $pidf ]; then kill -- -"$(cat $pidf)" 2>/dev/null || kill "$(cat $pidf)" 2>/dev/null || true; rm -f $pidf; sleep 2; fi; }
start() {
  psql -tAq "$BASE/postgres" -c "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 || psql -q "$BASE/postgres" -c "CREATE DATABASE $DB"
  ( DATABASE_URL="$URL" PORT=$PORT NODE_ENV=development setsid npx tsx server/index.ts > /tmp/lm-fixture.log 2>&1 & echo $! > $pidf )
  for _ in $(seq 60); do grep -q "locmoves\|listening\|ready" /tmp/lm-fixture.log 2>/dev/null && break; sleep 1; done
  echo "server pid $(cat $pidf) on http://localhost:$PORT (log /tmp/lm-fixture.log)"
}
case "${1:-}" in
  start) start ;;
  stop) stop ;;
  seed) N="$2"; K=$(printf %s "$N" | tr 'A-Z' 'a-z'); stop
    psql -q "$URL" -v n="$N" -v k="$K" <<'SQL'
INSERT INTO mine_factories VALUES (:'k', :'n', 1, 0) ON CONFLICT (player_key) DO UPDATE SET level = GREATEST(mine_factories.level, 1);
DELETE FROM mine_items WHERE player_key = :'k' AND item_id IN ('copper','iron_bar');
INSERT INTO mine_items (player_key, owner_name, item_type, item_id, qty) VALUES (:'k', :'n', 'ore', 'copper', 300), (:'k', :'n', 'bar', 'iron_bar', 40);
CREATE TABLE IF NOT EXISTS properties (id TEXT PRIMARY KEY, owner_key TEXT NOT NULL, owner_name TEXT NOT NULL, price BIGINT NOT NULL, bought_at BIGINT NOT NULL, arrears INT NOT NULL DEFAULT 0, tax_paid BIGINT NOT NULL DEFAULT 0, deed TEXT);
INSERT INTO properties (id, owner_key, owner_name, price, bought_at) VALUES ('b:house:-691:-188', :'k', :'n', 1, 1) ON CONFLICT (id) DO NOTHING;
INSERT INTO fish_catches (id, player_key, name, species, weight_g, value, caught_at, loc) VALUES ('fx-' || :'k' || '-1', :'k', :'n', 'bass', 900, 40, 1, 'fishing:lake'), ('fx-' || :'k' || '-2', :'k', :'n', 'trout', 500, 20, 1, 'fishing:lake') ON CONFLICT (id) DO NOTHING;
UPDATE casino_players SET chips = chips + 100000 WHERE player_key = :'k';
SQL
    start ;;
  *) sed -n 2,7p "$0"; exit 1 ;;
esac
