#!/usr/bin/env bash
# shellcheck disable=SC2016  # $POSTGRES_* in single quotes expand inside the container, on purpose
# PostgreSQL backup: pg_dump in custom format (-Fc, already compressed) from the postgres container.
#
#   backup.sh [--kind manual|daily|weekly|pre-deploy] [--label TEXT]   # prints the dump path on stdout
#   backup.sh --auto          # used by callcenter-backup.timer: weekly on WEEKLY_DOW, otherwise daily
#   backup.sh --prune-only    # apply retention without dumping
#
# Files: $BACKUP_DIR/<kind>/callcenter_<UTC yyyymmddThhmmssZ>_<kind>[_label].dump (+ .sha256), mode 600.
# A dump is accepted only if it is non-empty, `pg_restore --list` can read it and, when the database
# has tables, it contains table data.
#
# Retention (env, 0 = keep all): KEEP_DAILY=14 KEEP_WEEKLY=8 KEEP_PRE_DEPLOY=10 KEEP_MANUAL=0
# WEEKLY_DOW=7 (ISO weekday, 7 = Sunday) evaluated in BACKUP_TZ=Asia/Tashkent.
#
# Off-site copy hook (optional): if $APP_DIR/hooks/backup-offsite (or $OFFSITE_HOOK) is executable it
# is called as `<hook> <dump-file>` after daily/weekly backups. A failing hook fails the run (so the
# systemd unit shows up as failed) but the local dump is kept. See docs/rewrite/DEPLOY.md, "Бэкапы".
set -euo pipefail

SCRIPT_NAME=backup
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-8}"
KEEP_PRE_DEPLOY="${KEEP_PRE_DEPLOY:-10}"
KEEP_MANUAL="${KEEP_MANUAL:-0}"
WEEKLY_DOW="${WEEKLY_DOW:-7}"
BACKUP_TZ="${BACKUP_TZ:-Asia/Tashkent}"
OFFSITE_HOOK="${OFFSITE_HOOK:-$APP_DIR/hooks/backup-offsite}"
MIN_FREE_MB="${MIN_FREE_MB:-200}"

KIND=manual
LABEL=""
AUTO=0
PRUNE_ONLY=0
while (($#)); do
  case "$1" in
    --kind)
      KIND="${2:-}"
      shift
      ;;
    --label)
      LABEL="${2:-}"
      shift
      ;;
    --auto) AUTO=1 ;;
    --prune-only) PRUNE_ONLY=1 ;;
    -h | --help)
      sed -n '3,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

if ((AUTO)); then
  if [[ "$(TZ="$BACKUP_TZ" date +%u)" == "$WEEKLY_DOW" ]]; then KIND=weekly; else KIND=daily; fi
fi
case "$KIND" in
  manual | daily | weekly | pre-deploy) ;;
  *) die "--kind must be manual, daily, weekly or pre-deploy" ;;
esac
LABEL="$(printf '%s' "$LABEL" | tr -c 'A-Za-z0-9._-' '-' | cut -c1-40)"

umask 077
mkdir -p "$LOG_DIR" "$BACKUP_DIR"
LOG_FILE="$LOG_DIR/backup.log"
require_cmd docker flock sha256sum df
# restore.sh already holds the backup lock and calls us for its safety dump.
[[ "${CC_BACKUP_LOCK_HELD:-0}" == 1 ]] || lock_or_die "$BACKUP_LOCK" 1800

keep_for() {
  case "$1" in
    daily) echo "$KEEP_DAILY" ;;
    weekly) echo "$KEEP_WEEKLY" ;;
    pre-deploy) echo "$KEEP_PRE_DEPLOY" ;;
    manual) echo "$KEEP_MANUAL" ;;
    *) echo 0 ;;
  esac
}

prune_kind() { # KIND: delete all but the newest N dumps (names sort chronologically)
  local kind="$1" keep dir files n i
  keep="$(keep_for "$kind")"
  dir="$BACKUP_DIR/$kind"
  ((keep > 0)) && [[ -d "$dir" ]] || return 0
  shopt -s nullglob
  files=("$dir"/callcenter_*.dump)
  shopt -u nullglob
  n=${#files[@]}
  for ((i = 0; i < n - keep; i++)); do
    rm -f -- "${files[i]}" "${files[i]}.sha256"
    log "pruned ${files[i]#"$BACKUP_DIR"/}"
  done
}

prune_all() {
  local k
  for k in daily weekly pre-deploy manual; do prune_kind "$k"; done
}

if ((PRUNE_ONLY)); then
  prune_all
  exit 0
fi

if ! service_running postgres; then
  if ((AUTO)) && [[ -z "$(state_get CURRENT_TAG)" ]]; then
    log "nothing deployed yet and postgres is not running: skipping scheduled backup"
    exit 0
  fi
  die "postgres container is not running (cd $APP_DIR && docker compose ps)"
fi
wait_postgres 60 || die "postgres is not ready"

# Free space: at least twice the newest dump, and MIN_FREE_MB.
last=""
shopt -s nullglob
for f in "$BACKUP_DIR"/*/callcenter_*.dump; do
  [[ -z "$last" || "$(basename "$f")" > "$(basename "$last")" ]] && last="$f"
done
shopt -u nullglob
need_kb=$((MIN_FREE_MB * 1024))
if [[ -n "$last" ]]; then
  last_kb=$(($(wc -c <"$last") * 2 / 1024))
  ((last_kb > need_kb)) && need_kb=$last_kb
fi
free_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 { print $4 }')"
((free_kb >= need_kb)) || die "not enough disk space in $BACKUP_DIR: ${free_kb} KB free, need ${need_kb} KB"

mkdir -p "$BACKUP_DIR/$KIND"
name="callcenter_$(date -u +%Y%m%dT%H%M%SZ)_${KIND}${LABEL:+_$LABEL}.dump"
dest="$BACKUP_DIR/$KIND/$name"
tmp="$dest.partial"
trap 'rm -f "$tmp"' EXIT

log "pg_dump -> ${dest#"$BACKUP_DIR"/}"
dc exec -T postgres sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' >"$tmp" ||
  die "pg_dump failed"
[[ -s "$tmp" ]] || die "pg_dump produced an empty file"

toc="$(dc exec -T postgres pg_restore --list <"$tmp")" || die "pg_restore cannot read the dump (corrupt?)"
tables="$(echo "select count(*) from pg_tables where schemaname = 'public';" | psql_db "")" ||
  die "cannot count tables"
if ((tables > 0)) && ! grep -q 'TABLE DATA' <<<"$toc"; then
  die "dump has no table data although the database has $tables tables"
fi

mv -f "$tmp" "$dest"
(cd "$BACKUP_DIR/$KIND" && sha256sum "$name" >"$name.sha256")
log "ok: ${dest#"$BACKUP_DIR"/} ($(($(wc -c <"$dest") / 1024)) KB, $tables tables)"

prune_kind "$KIND"

if [[ "$KIND" == daily || "$KIND" == weekly ]] && [[ -x "$OFFSITE_HOOK" ]]; then
  log "off-site hook: $OFFSITE_HOOK"
  if ! run "$OFFSITE_HOOK" "$dest"; then
    echo "$dest"
    die "off-site hook failed (the local dump is fine)"
  fi
fi

echo "$dest"
