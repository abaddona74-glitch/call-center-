#!/usr/bin/env bash
# shellcheck disable=SC2016  # $POSTGRES_* in single quotes expand inside the container, on purpose
# Restores the application database from a pg_dump custom-format file (made by backup.sh).
#
#   restore.sh --yes-destroy-current-data <file.dump>   # replace production data
#   restore.sh --test <file.dump>                       # restore test: scratch DB, row counts vs live, drop
#
# Options: --no-safety-backup   skip the dump of the current data taken right before the restore
#          --no-migrate         do not run migrations of the running image after the restore
#
# How the real restore works (all-or-nothing):
#   1. stop api (Caddy keeps serving the SPA; API calls fail meanwhile) and take a safety dump;
#   2. pg_restore into a NEW scratch database (the live one is untouched if this fails);
#   3. swap names: <db> -> <db>_before_restore_<ts>, scratch -> <db>;
#   4. migrate the restored data up to the running image (an older dump has fewer migrations),
#      swap back automatically if that fails;
#   5. start api, check health. The old database is kept until you drop it (command is printed).
# Restoring into a fresh database is stricter than `pg_restore --clean --if-exists` in place:
# --clean only drops objects present in the dump, so tables created by newer migrations would
# survive while kysely_migration forgets them, and the next deploy would fail.
set -euo pipefail

SCRIPT_NAME=restore
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

MODE=""
FILE=""
SAFETY_BACKUP=1
MIGRATE=1
while (($#)); do
  case "$1" in
    --yes-destroy-current-data) MODE=restore ;;
    --test) MODE="test" ;;
    --no-safety-backup) SAFETY_BACKUP=0 ;;
    --no-migrate) MIGRATE=0 ;;
    -h | --help)
      sed -n '3,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    -*) die "unknown option: $1" ;;
    *) FILE="$1" ;;
  esac
  shift
done
[[ -n "$MODE" ]] || die "refusing to run without --yes-destroy-current-data (or --test). See --help."
[[ -n "$FILE" && -f "$FILE" && -r "$FILE" ]] || die "dump file not found or not readable: ${FILE:-<none>}"
FILE="$(cd "$(dirname "$FILE")" && pwd)/$(basename "$FILE")"

umask 077
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/restore.log"
require_cmd docker flock comm join

lock_or_die "$DEPLOY_LOCK" 0
lock_or_die "$BACKUP_LOCK" 1800
export CC_BACKUP_LOCK_HELD=1

service_running postgres || die "postgres is not running (cd $APP_DIR && docker compose up -d postgres)"
# The image whose migrations the restored data is brought up to: the one serving now.
RUN_IMAGE="$(service_image api || true)"
[[ -n "$RUN_IMAGE" ]] || RUN_IMAGE="$(env_get REGISTRY "$DEFAULT_REGISTRY")/call-center-api:$(env_get IMAGE_TAG local)"
export IMAGE_TAG="${RUN_IMAGE##*:}"
wait_postgres 60 || die "postgres is not ready"

read -r PG_USER PG_DB < <(dc exec -T postgres sh -c 'printf "%s %s\n" "$POSTGRES_USER" "$POSTGRES_DB"') ||
  die "cannot read POSTGRES_USER/POSTGRES_DB from the postgres container"
[[ "$PG_DB" =~ ^[a-z_][a-z0-9_]*$ && "$PG_USER" =~ ^[a-z_][a-z0-9_]*$ ]] || die "unexpected POSTGRES_DB/POSTGRES_USER"
STAMP="$(date -u +%Y%m%d%H%M%S)"
SCRATCH_DB="${PG_DB}_restore_${STAMP}"
OLD_DB="${PG_DB}_before_restore_${STAMP}"
IN_CONTAINER=/tmp/cc-restore-$STAMP.dump

SCRATCH_CREATED=0
SWAP=none # none | live-renamed | swapped
API_STOPPED=0

sql_postgres() { psql_db postgres "$@"; } # maintenance DB, SQL on stdin

rename_db() { # FROM TO
  printf '%s\n' 'ALTER DATABASE :"from" RENAME TO :"to";' | sql_postgres -v from="$1" -v to="$2"
}

terminate_connections() { # DB
  printf '%s\n' "select count(pg_terminate_backend(pid)) from pg_stat_activity where datname = :'db' and pid <> pg_backend_pid();" |
    sql_postgres -v db="$1" >/dev/null
}

row_counts() { # DB -> "table|rows" lines, exact counts
  cat <<'SQL' | psql_db "$1"
select table_name || '|' || (xpath('/row/c/text()',
         query_to_xml(format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text
  from information_schema.tables
 where table_schema = 'public' and table_type = 'BASE TABLE'
 order by 1;
SQL
}

on_exit() {
  local code=$?
  set +e
  trap - EXIT INT TERM
  if ((code != 0)); then
    case "$SWAP" in
      live-renamed) rename_db "$OLD_DB" "$PG_DB" && log "put the live database back" && SWAP=none ;;
      swapped) log "restored data is in place as $PG_DB; previous data kept as $OLD_DB" ;;
      *) ;;
    esac
    if ((SCRATCH_CREATED)) && [[ "$SWAP" == none ]]; then
      echo "drop database if exists :\"db\";" | sql_postgres -v db="$SCRATCH_DB" >/dev/null 2>&1 &&
        log "dropped scratch database $SCRATCH_DB"
    fi
    if ((API_STOPPED)); then
      run dc up -d --no-build api && log "api started again"
    fi
    log "RESTORE FAILED (log: $LOG_FILE)"
  fi
  dc exec -T postgres rm -f "$IN_CONTAINER" >/dev/null 2>&1
  exit "$code"
}
trap on_exit EXIT
trap 'log "interrupted"; exit 130' INT TERM

log "=== restore ($MODE) from $FILE ==="
run dc cp "$FILE" "postgres:$IN_CONTAINER" || die "cannot copy the dump into the postgres container"
run dc exec -T postgres pg_restore --list "$IN_CONTAINER" || die "not a readable pg_dump custom-format file"

if [[ "$MODE" == restore ]]; then
  if service_running api; then
    run dc stop api || die "cannot stop api"
    API_STOPPED=1
  fi
  if ((SAFETY_BACKUP)); then
    safety="$(bash "$SCRIPT_DIR/backup.sh" --kind manual --label pre-restore)" || die "safety backup failed"
    log "safety backup of the current data: $safety"
  fi
fi

log "pg_restore into scratch database $SCRATCH_DB"
echo 'create database :"db" owner :"owner";' | sql_postgres -v db="$SCRATCH_DB" -v owner="$PG_USER" >/dev/null
SCRATCH_CREATED=1
run dc exec -T postgres pg_restore -U "$PG_USER" -d "$SCRATCH_DB" \
  --no-owner --no-privileges --exit-on-error --single-transaction "$IN_CONTAINER" ||
  die "pg_restore failed; the live database was not touched"

if [[ "$MODE" == test ]]; then
  log "row counts (table | backup | live):"
  join -t '|' -a 1 -a 2 -e '-' -o '0,1.2,2.2' <(row_counts "$SCRATCH_DB" | sort) <(row_counts "" | sort) |
    awk -F'|' '{ printf "    %-40s %12s %12s\n", $1, $2, $3 }' >&2
  last_migration="$(echo 'select max(name) from kysely_migration;' | psql_db "$SCRATCH_DB" 2>/dev/null || echo '?')"
  log "latest migration in the backup: ${last_migration:-none}"
  echo 'drop database :"db";' | sql_postgres -v db="$SCRATCH_DB" >/dev/null
  SCRATCH_CREATED=0
  log "=== restore test OK (scratch database dropped) ==="
  exit 0
fi

log "swapping databases: $PG_DB -> $OLD_DB, $SCRATCH_DB -> $PG_DB"
terminate_connections "$PG_DB"
rename_db "$PG_DB" "$OLD_DB" || die "cannot rename the live database (connections left?)"
SWAP=live-renamed
rename_db "$SCRATCH_DB" "$PG_DB" || die "cannot rename the scratch database"
SWAP=swapped
SCRATCH_CREATED=0

if ((MIGRATE)); then
  if ! apply_migrations "$RUN_IMAGE"; then
    log "migrating the restored data failed: swapping back"
    rename_db "$PG_DB" "$SCRATCH_DB" && rename_db "$OLD_DB" "$PG_DB" && SWAP=none && SCRATCH_CREATED=1
    die "restore aborted, the previous data is live again"
  fi
fi

run dc up -d --no-build api || die "cannot start api"
API_STOPPED=0
wait_healthy "" "${DEPLOY_HEALTH_TIMEOUT:-$(env_get DEPLOY_HEALTH_TIMEOUT 180)}" || die "api is unhealthy after the restore (restored data stays in place)"

log "=== RESTORE OK ==="
log "previous data is kept as database $OLD_DB. When everything is verified, drop it:"
log "  cd $APP_DIR && docker compose exec postgres dropdb -U $PG_USER $OLD_DB"
