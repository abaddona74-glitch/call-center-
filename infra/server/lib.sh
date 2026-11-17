# shellcheck shell=bash
# shellcheck disable=SC2016,SC2034  # $VARS in single quotes expand inside the containers; vars used by callers
# Shared helpers for infra/server/*.sh. Sourced, never executed directly.
#
# Production layout (created by bootstrap.sh, owned by the `deploy` user):
#   /opt/callcenter/compose.yml            copy of infra/compose.yml (installed by deploy.sh)
#   /opt/callcenter/compose.override.yml   copy of infra/server/compose.override.yml (installed by deploy.sh)
#   /opt/callcenter/.env                   secrets and settings, chmod 600, filled by the owner, never committed
#   /opt/callcenter/bin/                   these scripts (refreshed by every successful deploy)
#   /opt/callcenter/backups/<kind>/        pg_dump files (daily, weekly, pre-deploy, manual)
#   /opt/callcenter/releases/<sha>/        files uploaded by the deploy workflow
#   /opt/callcenter/logs/                  deploy/backup/restore logs (rotated by logrotate)
#   /opt/callcenter/.deploy-state          CURRENT_TAG / PREVIOUS_TAG
#   /opt/callcenter/.deploy-history        one line per deploy attempt
#
# APP_DIR and COMPOSE_PROJECT_NAME may be overridden ONLY to test against a throwaway project.

export LC_ALL=C

APP_DIR="${APP_DIR:-/opt/callcenter}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
LOG_DIR="${LOG_DIR:-$APP_DIR/logs}"
STATE_FILE="$APP_DIR/.deploy-state"
HISTORY_FILE="$APP_DIR/.deploy-history"
DEPLOY_LOCK="$APP_DIR/.deploy.lock"
BACKUP_LOCK="$APP_DIR/.backup.lock"
DEFAULT_REGISTRY="ghcr.io/nuriddin2468"
SCRIPT_NAME="${SCRIPT_NAME:-callcenter}"
LOG_FILE="${LOG_FILE:-}"
LOG_TEE=0 # 1 = stderr is already tee'd into LOG_FILE (deploy.sh)

# ---------------------------------------------------------------- logging

ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Every message goes to the log file (if set) and to stderr. stdout is reserved for results
# (backup.sh prints the dump path there). Writes never fail the script.
log() {
  local msg
  msg="$(ts) [$SCRIPT_NAME] $*"
  if [[ -n "$LOG_FILE" && "$LOG_TEE" != 1 ]]; then printf '%s\n' "$msg" >>"$LOG_FILE" 2>/dev/null || true; fi
  printf '%s\n' "$msg" >&2 2>/dev/null || true
}
warn() { log "WARN: $*"; }
die() {
  log "ERROR: $*"
  exit 1
}

# run [--show] CMD...: logs the command, keeps its full output in the log file and prints the
# output to stderr only on failure (or always with --show). Returns the command's exit code.
run() {
  local show=0 out rc=0
  if [[ "${1:-}" == --show ]]; then
    show=1
    shift
  fi
  log "+ $*"
  out="$(mktemp)"
  "$@" >"$out" 2>&1 || rc=$?
  if [[ -n "$LOG_FILE" ]]; then cat "$out" >>"$LOG_FILE" 2>/dev/null || true; fi
  if ((show || rc != 0)); then
    tail -n 60 "$out" | sed 's/^/    | /' >&2 2>/dev/null || true
  fi
  rm -f "$out"
  return "$rc"
}

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "required command not found: $c"
  done
}

# lock_or_die FILE WAIT_SECONDS: exclusive flock held until the process exits.
# Children inherit the descriptor, which is fine: they finish before we do.
lock_or_die() {
  local file="$1" wait="${2:-0}" fd
  exec {fd}>>"$file"
  flock -w "$wait" "$fd" || die "another operation holds $file (deploy/backup/restore running?)"
}

# ---------------------------------------------------------------- .env and state

# strip_value VALUE: trims, removes matching surrounding quotes, or an inline " # comment" when unquoted.
strip_value() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%"${v##*[![:space:]]}"}"
  if [[ ${#v} -ge 2 && (("${v:0:1}" == '"' && "${v: -1}" == '"') || ("${v:0:1}" == "'" && "${v: -1}" == "'")) ]]; then
    v="${v:1:${#v}-2}"
  else
    v="${v%%[[:space:]]#*}"
    v="${v%"${v##*[![:space:]]}"}"
  fi
  printf '%s' "$v"
}

# env_get KEY [DEFAULT]: reads KEY from .env WITHOUT sourcing it (values may contain shell
# metacharacters). The last occurrence wins; an empty value yields DEFAULT.
env_get() {
  local key="$1" default="${2-}" line value
  [[ -r "$ENV_FILE" ]] || {
    printf '%s' "$default"
    return 0
  }
  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$ENV_FILE" | tail -n 1 || true)"
  value="$(strip_value "${line#*=}")"
  [[ -n "$line" && -n "$value" ]] || value="$default"
  printf '%s' "$value"
}

state_get() {
  [[ -r "$STATE_FILE" ]] || return 0
  sed -n "s/^$1=//p" "$STATE_FILE" | tail -n 1
}

state_write() { # CURRENT PREVIOUS
  local tmp
  tmp="$(mktemp "$STATE_FILE.XXXXXX")"
  printf 'CURRENT_TAG=%s\nPREVIOUS_TAG=%s\nUPDATED_AT=%s\n' "$1" "$2" "$(ts)" >"$tmp"
  mv -f "$tmp" "$STATE_FILE"
}

history_append() { # STATUS TAG PREVIOUS [NOTE]
  printf '%s %s %s %s %s\n' "$(ts)" "$1" "${2:--}" "${3:--}" "${4:--}" >>"$HISTORY_FILE"
}

is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }

# ---------------------------------------------------------------- docker compose

# Always the installed project: compose.yml + compose.override.yml + .env in APP_DIR,
# exactly what an admin gets with `cd /opt/callcenter && docker compose ...`.
dc() { (cd "$APP_DIR" && docker compose "$@"); }

service_running() { [[ -n "$(dc ps -q --status running "$1" 2>/dev/null)" ]]; }

# Image reference ("repo:tag") of the running container of a service.
service_image() {
  local id
  id="$(dc ps -q "$1" 2>/dev/null | head -n 1)"
  [[ -n "$id" ]] || return 1
  docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null
}

wait_postgres() { # [TIMEOUT]
  local deadline=$((SECONDS + ${1:-60}))
  until dc exec -T postgres sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; do
    ((SECONDS < deadline)) || return 1
    sleep 2
  done
}

# psql_db DATABASE|"" [psql args...] — SQL on stdin, runs inside the postgres container as
# POSTGRES_USER over the local socket (no password needed there). "" = POSTGRES_DB.
psql_db() {
  local db="${1:-}"
  shift || true
  dc exec -T postgres sh -c \
    'db="$1"; shift; exec psql -qAtX -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${db:-$POSTGRES_DB}" "$@"' \
    sh "$db" "$@"
}

# ---------------------------------------------------------------- migrations

# Migration names shipped in an image (same rules as kysely's FileMigrationProvider).
image_migrations() {
  docker run --rm --network none --entrypoint sh "$1" -c 'ls -1 dist/database/migrations 2>/dev/null || true' |
    sed -E '/\.d\.[cm]?ts$/d' | sed -nE 's/\.([cm]?js|[cm]?ts)$//p' | sort -u
}

db_migrations() {
  local exists
  exists="$(echo "select to_regclass('public.kysely_migration') is not null;" | psql_db "")" || return 1
  [[ "$exists" == t ]] || return 0
  echo "select name from kysely_migration order by name;" | psql_db ""
}

# apply_migrations IMAGE: applies IMAGE's pending migrations in a one-off `api` container (the caller
# exports IMAGE_TAG so that `api` resolves to IMAGE). If the database already has migrations the
# image does not know, the image is older (rollback, redeploy of an earlier SHA, restore of a newer
# dump): skip with a warning, never `migrate down`. Returns 1 on failure or divergence.
apply_migrations() {
  local image="$1" in_image in_db pending ahead
  in_image="$(image_migrations "$image")" || {
    log "cannot list migrations in $image"
    return 1
  }
  in_db="$(db_migrations)" || {
    log "cannot read kysely_migration from postgres"
    return 1
  }
  pending="$(comm -13 <(printf '%s\n' "$in_db") <(printf '%s\n' "$in_image") | sed '/^$/d')"
  ahead="$(comm -23 <(printf '%s\n' "$in_db") <(printf '%s\n' "$in_image") | sed '/^$/d')"
  if [[ -n "$ahead" && -n "$pending" ]]; then
    log "schema diverged: database has $(echo "$ahead" | tr '\n' ' ')unknown to the image, image has unapplied $(echo "$pending" | tr '\n' ' ')"
    return 1
  fi
  if [[ -n "$ahead" ]]; then
    warn "database is AHEAD of $image (older release): not migrating; newer migrations stay: $(echo "$ahead" | tr '\n' ' ')"
    return 0
  fi
  if [[ -z "$pending" ]]; then
    log "migrations: nothing pending"
    return 0
  fi
  log "migrations pending: $(echo "$pending" | tr '\n' ' ')"
  run --show dc run --rm -T --no-deps api node dist/database/migrate.js latest
}

# ---------------------------------------------------------------- health checks

HEALTH_REASON=""

# /api/health inside the api container: proves the process is up and Postgres answers.
api_health_ok() {
  local out
  out="$(dc exec -T api wget -qO- -T 5 http://127.0.0.1:3000/api/health 2>/dev/null)" || {
    HEALTH_REASON="api: /api/health not answering"
    return 1
  }
  [[ "$out" == *'"status":"ok"'* ]] || {
    HEALTH_REASON="api: unexpected /api/health response"
    return 1
  }
}

# hostport VALUE: "8080" -> "127.0.0.1:8080", "192.0.2.10:80" -> unchanged, "0.0.0.0:80" -> "127.0.0.1:80".
hostport() {
  local p="$1" ip
  if [[ "$p" == *:* ]]; then
    ip="${p%:*}"
    [[ "$ip" == 0.0.0.0 ]] && ip=127.0.0.1
    printf '%s:%s' "$ip" "${p##*:}"
  else
    printf '127.0.0.1:%s' "$p"
  fi
}

# Works out how to reach /api/health THROUGH Caddy from this host (proves the web image, the
# Caddyfile and the /api proxy). Sets EDGE_URL ("" = check disabled) and EDGE_ARGS (curl args).
#   DEPLOY_EDGE_CHECK=off  in .env disables it; DEPLOY_EDGE_URL=<url> forces a URL.
edge_setup() {
  EDGE_URL=""
  EDGE_ARGS=()
  local mode site scheme host hp ip port
  mode="$(env_get DEPLOY_EDGE_CHECK auto)"
  [[ "$mode" == off ]] && return 0
  EDGE_URL="${DEPLOY_EDGE_URL:-$(env_get DEPLOY_EDGE_URL "")}"
  if [[ -n "$EDGE_URL" ]]; then
    EDGE_ARGS=(-k)
    return 0
  fi
  site="$(env_get SITE_ADDRESS :80)"
  site="${site%%[, ]*}" # Caddy allows several addresses; the first one is enough
  scheme=https
  case "$site" in
    http://*) scheme=http site="${site#http://}" ;;
    https://*) site="${site#https://}" ;;
    *) ;;
  esac
  site="${site%%/*}"
  host="${site%:*}"
  [[ "$site" == :* ]] && { scheme=http host=""; }
  if [[ "$scheme" == http ]]; then
    hp="$(hostport "$(env_get HTTP_PORT 8080)")"
  else
    hp="$(hostport "$(env_get HTTPS_PORT 8443)")"
  fi
  ip="${hp%:*}"
  port="${hp##*:}"
  if [[ -z "$host" ]]; then
    EDGE_URL="http://$hp/api/health"
  elif [[ "$host" =~ ^[0-9.]+$ ]]; then
    EDGE_URL="$scheme://$host:$port/api/health"
    EDGE_ARGS=(-k)
  else
    # Connect to the local port but present the real host name (SNI + Host). -k: this check is
    # about routing; certificate validity is for external monitoring (first issuance takes time).
    EDGE_URL="$scheme://$host:$port/api/health"
    EDGE_ARGS=(-k --resolve "$host:$port:$ip")
  fi
}

edge_health_ok() {
  [[ -n "${EDGE_URL:-}" ]] || return 0
  local out
  out="$(curl -fsS -m 5 "${EDGE_ARGS[@]}" "$EDGE_URL" 2>/dev/null)" || {
    HEALTH_REASON="edge: $EDGE_URL not answering through Caddy"
    return 1
  }
  [[ "$out" == *'"status":"ok"'* ]] || {
    HEALTH_REASON="edge: unexpected response from $EDGE_URL"
    return 1
  }
}

# wait_healthy TAG|"" TIMEOUT: api and web run TAG (if given), api health ok, Caddy route ok.
wait_healthy() {
  local tag="$1" timeout="${2:-180}" deadline img svc ok
  deadline=$((SECONDS + timeout))
  edge_setup
  log "health check (timeout ${timeout}s, edge: ${EDGE_URL:-disabled})"
  while ((SECONDS < deadline)); do
    ok=1
    if [[ -n "$tag" ]]; then
      for svc in api web; do
        img="$(service_image "$svc" || true)"
        if [[ "$img" != *":$tag" ]]; then
          HEALTH_REASON="$svc: running '${img:-nothing}', expected tag $tag"
          ok=0
          break
        fi
      done
    fi
    if ((ok)) && api_health_ok && edge_health_ok; then
      log "health check passed"
      return 0
    fi
    sleep 5
  done
  log "health check failed: $HEALTH_REASON"
  return 1
}

dump_diagnostics() {
  log "diagnostics (also in ${LOG_FILE:-stderr}):"
  run --show dc ps -a || true
  run --show dc logs --no-color --tail 40 api web || true
}
