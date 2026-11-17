#!/usr/bin/env bash
# Deploys one release on the production server. Both images are tagged with the full git SHA.
#
#   deploy.sh [--registry-auth-stdin] <sha>   # started by .github/workflows/deploy.yml (as user deploy)
#   deploy.sh --rollback                      # redeploy PREVIOUS_TAG from .deploy-state
#   deploy.sh --status                        # current/previous release, running images, history
#
# --registry-auth-stdin: read two lines from stdin (registry user, token) and use them for this
# pull only, in a throwaway DOCKER_CONFIG. The workflow passes its short-lived GITHUB_TOKEN this
# way, so no registry credential is stored on the server. Without it, `docker pull` uses whatever
# the deploy user is logged in with (read:packages PAT) or anonymous access (public packages).
#
# Steps: lock -> check .env -> pg_dump backup -> docker pull -> install compose files ->
# migrations in a one-off container (old version still serving) -> docker compose up ->
# health check -> success, or automatic rollback to the previous images.
# The database is NEVER restored automatically: migrations must be backward compatible, and a
# restore would throw away everything written since the backup. The backup path and the restore
# command are printed instead. Runbook: docs/rewrite/DEPLOY.md
set -euo pipefail

SCRIPT_NAME=deploy
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

HEALTH_TIMEOUT="${DEPLOY_HEALTH_TIMEOUT:-}"
KEEP_RELEASES="${KEEP_RELEASES:-10}"
KEEP_IMAGES="${KEEP_IMAGES:-5}"
ROLLBACK_DIR="$APP_DIR/.rollback"

usage() {
  sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
}

REGISTRY_AUTH=0
MODE=deploy
NEW_TAG=""
while (($#)); do
  case "$1" in
    --registry-auth-stdin) REGISTRY_AUTH=1 ;;
    --rollback) MODE=rollback ;;
    --status) MODE=status ;;
    -h | --help) usage ;;
    -*) die "unknown option: $1" ;;
    *) NEW_TAG="$1" ;;
  esac
  shift
done

if [[ "$MODE" == status ]]; then
  echo "app dir:  $APP_DIR"
  echo "current:  $(state_get CURRENT_TAG)"
  echo "previous: $(state_get PREVIOUS_TAG)"
  echo "running:  api=$(service_image api || echo -) web=$(service_image web || echo -)"
  echo "history (newest last): time status tag previous note"
  tail -n 15 "$HISTORY_FILE" 2>/dev/null || true
  exit 0
fi

# ---------------------------------------------------------------- setup

umask 027
[[ -d "$APP_DIR" ]] || die "$APP_DIR does not exist (run bootstrap.sh first)"
mkdir -p "$LOG_DIR" "$APP_DIR/releases" "$APP_DIR/bin"
LOG_FILE="$LOG_DIR/deploy.log"
require_cmd docker flock curl cmp sed awk comm tee
docker compose version >/dev/null 2>&1 || die "docker compose plugin is missing"
tee -p </dev/null >/dev/null 2>&1 || die "GNU tee (coreutils) with -p is required"

# All output (ours and every child's) goes through tee: to the SSH session AND to the log file.
# `tee -p` keeps writing the file after the session is gone (cancelled workflow, network drop), so
# no process of the deploy ever hits a broken pipe: it finishes or rolls back on its own.
exec > >(tee -p -a "$LOG_FILE") 2>&1
TEE_PID=$!
LOG_TEE=1
trap '' HUP

REG_USER=""
REG_PASS=""
if ((REGISTRY_AUTH)); then
  IFS= read -r REG_USER || true
  IFS= read -r REG_PASS || true
  [[ -n "$REG_USER" && -n "$REG_PASS" ]] || die "--registry-auth-stdin: expected two lines (user, token) on stdin"
fi
exec </dev/null # nothing below may read the token

lock_or_die "$DEPLOY_LOCK" 0

PREV_TAG="$(state_get CURRENT_TAG)"
if [[ -z "$PREV_TAG" ]]; then
  # No state yet but something may be running (manual first start): take the tag from the container.
  img="$(service_image api || true)"
  [[ "$img" == *:* ]] && PREV_TAG="${img##*:}"
  is_sha "$PREV_TAG" || PREV_TAG=""
fi
if [[ "$MODE" == rollback ]]; then
  NEW_TAG="$(state_get PREVIOUS_TAG)"
  [[ -n "$NEW_TAG" ]] || die "no PREVIOUS_TAG in $STATE_FILE"
fi
is_sha "$NEW_TAG" || die "usage: deploy.sh [--registry-auth-stdin] <full 40-char git sha>"

ROLLBACK_TAG="$PREV_TAG"
if [[ "$PREV_TAG" == "$NEW_TAG" ]]; then
  log "$NEW_TAG is already the current release: re-applying it (e.g. after a .env change)"
fi

[[ -f "$ENV_FILE" ]] || die "$ENV_FILE not found. Create it from .env.example (docs/rewrite/DEPLOY.md)"
EXAMPLE_FILE="$SCRIPT_DIR/../.env.example"
check_args=(--env "$ENV_FILE")
[[ -f "$EXAMPLE_FILE" ]] && check_args+=(--example "$EXAMPLE_FILE")
bash "$SCRIPT_DIR/check-env.sh" "${check_args[@]}" || die "fix $ENV_FILE first (see messages above)"

REGISTRY="$(env_get REGISTRY "$DEFAULT_REGISTRY")"
REGISTRY="${REGISTRY%/}"
API_IMAGE="$REGISTRY/call-center-api:$NEW_TAG"
WEB_IMAGE="$REGISTRY/call-center-web:$NEW_TAG"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-$(env_get DEPLOY_HEALTH_TIMEOUT 180)}"

# PHASE drives the EXIT trap: prepare = nothing changed yet; files = compose files replaced;
# switch = containers are being replaced (failure -> rollback); done = success.
PHASE=prepare
BACKUP_PATH=""
TMP_DOCKER_CONFIG=""
STARTED=$SECONDS

# ---------------------------------------------------------------- helpers

install_file() { # SRC DST: installs a release file, remembering the old one for rollback
  local src="$1" dst="$2" name
  name="$(basename "$dst")"
  [[ -f "$src" ]] || return 0
  if [[ -f "$dst" ]] && cmp -s "$src" "$dst"; then return 0; fi
  if [[ -f "$dst" ]]; then
    cp -p "$dst" "$ROLLBACK_DIR/$name"
  else
    : >"$ROLLBACK_DIR/$name.absent"
  fi
  cp "$src" "$dst.new" && chmod 640 "$dst.new" && mv -f "$dst.new" "$dst"
  log "installed $name from the release"
}

install_release_files() {
  install_file "$SCRIPT_DIR/../compose.yml" "$APP_DIR/compose.yml"
  install_file "$SCRIPT_DIR/compose.override.yml" "$APP_DIR/compose.override.yml"
  [[ -f "$APP_DIR/compose.yml" ]] || die "no compose.yml in $APP_DIR or in the release"
}

restore_release_files() {
  local f
  for f in compose.yml compose.override.yml; do
    if [[ -f "$ROLLBACK_DIR/$f" ]]; then
      cp -p "$ROLLBACK_DIR/$f" "$APP_DIR/$f" && log "restored previous $f"
    elif [[ -f "$ROLLBACK_DIR/$f.absent" ]]; then
      rm -f "$APP_DIR/$f" && log "removed $f (it did not exist before)"
    fi
  done
}

pull_images() {
  local -a env_prefix=()
  # Tags are immutable commit SHAs, so a local copy is the same release (lets a manual
  # `deploy.sh --rollback` work without registry credentials).
  if docker image inspect "$API_IMAGE" >/dev/null 2>&1 && docker image inspect "$WEB_IMAGE" >/dev/null 2>&1; then
    log "images for $NEW_TAG are already present locally, not pulling"
    cleanup_registry_auth
    return 0
  fi
  if ((REGISTRY_AUTH)); then
    TMP_DOCKER_CONFIG="$(mktemp -d)"
    env_prefix=(env "DOCKER_CONFIG=$TMP_DOCKER_CONFIG")
    log "+ docker login ${REGISTRY%%/*} (temporary credentials from the workflow)"
    printf '%s' "$REG_PASS" | "${env_prefix[@]}" docker login "${REGISTRY%%/*}" -u "$REG_USER" --password-stdin >/dev/null 2>&1 ||
      die "docker login to ${REGISTRY%%/*} failed"
  fi
  run "${env_prefix[@]}" docker pull "$API_IMAGE" || die "cannot pull $API_IMAGE (built and pushed? registry access?)"
  run "${env_prefix[@]}" docker pull "$WEB_IMAGE" || die "cannot pull $WEB_IMAGE"
  cleanup_registry_auth
}

cleanup_registry_auth() {
  if [[ -n "$TMP_DOCKER_CONFIG" ]]; then
    rm -rf "$TMP_DOCKER_CONFIG"
    TMP_DOCKER_CONFIG=""
  fi
  REG_PASS=""
}

sync_env_image_tag() { # keep IMAGE_TAG in .env equal to the running release, so a plain
  local tag="$1" tmp #   `docker compose up -d` by an admin never starts something else
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  if grep -qE '^[[:space:]]*IMAGE_TAG=' "$ENV_FILE"; then
    sed -E "s/^[[:space:]]*IMAGE_TAG=.*/IMAGE_TAG=$tag/" "$ENV_FILE" >"$tmp"
  else
    cat "$ENV_FILE" >"$tmp"
    [[ -s "$tmp" && -n "$(tail -c 1 "$tmp")" ]] && echo >>"$tmp"
    echo "IMAGE_TAG=$tag" >>"$tmp"
  fi
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
}

install_scripts() {
  local f
  [[ "$SCRIPT_DIR" -ef "$APP_DIR/bin" ]] && return 0
  for f in lib.sh deploy.sh backup.sh restore.sh check-env.sh; do
    [[ -f "$SCRIPT_DIR/$f" ]] && install -m 750 "$SCRIPT_DIR/$f" "$APP_DIR/bin/$f"
  done
  if [[ -f "$EXAMPLE_FILE" ]]; then install -m 640 "$EXAMPLE_FILE" "$APP_DIR/.env.example"; fi
  log "installed scripts into $APP_DIR/bin"
}

prune() {
  local keep repo tag dir name
  keep="$(
    {
      echo "$NEW_TAG"
      echo "$ROLLBACK_TAG"
      awk '$2 == "ok" { print $3 }' "$HISTORY_FILE" 2>/dev/null | tail -n "$KEEP_IMAGES"
    } | sed '/^$/d' | sort -u
  )"
  for repo in "$REGISTRY/call-center-api" "$REGISTRY/call-center-web"; do
    docker image ls --format '{{.Tag}}' "$repo" 2>/dev/null | while IFS= read -r tag; do
      [[ -z "$tag" || "$tag" == "<none>" ]] && continue
      grep -qxF "$tag" <<<"$keep" || docker image rm "$repo:$tag" >/dev/null 2>&1 || true
    done
  done
  docker image prune -f >/dev/null 2>&1 || true
  # release folders: keep the newest $KEEP_RELEASES plus everything in $keep (names are SHAs)
  # shellcheck disable=SC2012
  ls -1t "$APP_DIR/releases" 2>/dev/null | tail -n +"$((KEEP_RELEASES + 1))" | while IFS= read -r name; do
    dir="$APP_DIR/releases/$name"
    is_sha "$name" || continue
    grep -qxF "$name" <<<"$keep" && continue
    rm -rf -- "$dir"
  done
}

print_db_restore_help() {
  [[ -n "$BACKUP_PATH" ]] || return 0
  log "The database was NOT restored (automatic restores lose data written since the backup)."
  log "Restore ONLY if the running version cannot work with the migrated schema:"
  log "  $APP_DIR/bin/restore.sh --yes-destroy-current-data $BACKUP_PATH"
}

rollback() {
  log "ROLLBACK: deploy of $NEW_TAG failed"
  dump_diagnostics
  restore_release_files
  if [[ -z "$ROLLBACK_TAG" ]]; then
    log "no previous release (first deploy): nothing to roll back to, containers left for inspection"
    history_append failed "$NEW_TAG" - first-deploy
    return 1
  fi
  export IMAGE_TAG="$ROLLBACK_TAG"
  local svc ref
  for svc in api web; do
    ref="$REGISTRY/call-center-$svc:$ROLLBACK_TAG"
    docker image inspect "$ref" >/dev/null 2>&1 || run docker pull "$ref" || log "previous image $ref is gone"
  done
  if run dc up -d --no-build --remove-orphans && wait_healthy "$ROLLBACK_TAG" "$HEALTH_TIMEOUT"; then
    sync_env_image_tag "$ROLLBACK_TAG" || true
    history_append rolled-back "$NEW_TAG" "$ROLLBACK_TAG" "now-running-$ROLLBACK_TAG"
    log "ROLLBACK OK: $ROLLBACK_TAG is running again"
  else
    dump_diagnostics
    history_append rollback-failed "$NEW_TAG" "$ROLLBACK_TAG"
    log "ROLLBACK FAILED: the site may be down. See docs/rewrite/DEPLOY.md, 'Откат вручную'."
  fi
  print_db_restore_help
}

on_exit() {
  local code=$?
  set +e
  trap - EXIT INT TERM
  cleanup_registry_auth
  if ((code != 0)); then
    case "$PHASE" in
      prepare) history_append failed "$NEW_TAG" "${ROLLBACK_TAG:--}" before-switch ;;
      files)
        restore_release_files
        history_append failed "$NEW_TAG" "${ROLLBACK_TAG:--}" before-switch
        log "nothing was switched: ${ROLLBACK_TAG:-the old version} keeps running"
        ;;
      switch) rollback ;;
      *) ;;
    esac
    log "DEPLOY FAILED after $((SECONDS - STARTED))s (log: $LOG_FILE)"
  fi
  # let tee flush the last lines to the SSH session before we exit
  exec >&- 2>&-
  wait "$TEE_PID" 2>/dev/null
  exit "$code"
}

trap on_exit EXIT
trap 'log "interrupted"; exit 130' INT TERM

# ---------------------------------------------------------------- deploy

rm -rf "$ROLLBACK_DIR"
mkdir -p "$ROLLBACK_DIR"
log "=== deploy $NEW_TAG (current: ${PREV_TAG:-none}) ==="

# 1. Pre-deploy backup with the CURRENT compose files (first deploy: install the release ones).
if [[ ! -f "$APP_DIR/compose.yml" ]]; then
  PHASE=files
  install_release_files
fi
export IMAGE_TAG="${PREV_TAG:-$NEW_TAG}"
if ! service_running postgres; then
  run dc up -d --no-build postgres || die "cannot start postgres"
fi
wait_postgres 90 || die "postgres is not ready"
BACKUP_PATH="$(bash "$SCRIPT_DIR/backup.sh" --kind pre-deploy --label "${NEW_TAG:0:12}")" || die "pre-deploy backup failed"
log "backup: $BACKUP_PATH"

# 2. Pull. Nothing is changed if an image is missing.
pull_images

# 3. Compose files from the release (old copies kept for rollback).
PHASE=files
install_release_files
export IMAGE_TAG="$NEW_TAG"
run dc config -q || die "compose configuration is invalid"

# 4. Migrations in a one-off container of the new image while the old version keeps serving.
#    Every migration must therefore be backward compatible with the previous release
#    (expand -> deploy -> contract). An image older than the database skips them.
apply_migrations "$API_IMAGE" ||
  die "migrations failed (kysely applies the batch in one transaction: nothing was applied). Old version still serving."

# 5. Switch.
PHASE=switch
run dc up -d --no-build --remove-orphans || die "docker compose up failed"

# 6. Verify.
wait_healthy "$NEW_TAG" "$HEALTH_TIMEOUT" || die "new release is unhealthy"

# 7. Record.
PHASE="done"
if [[ "$PREV_TAG" == "$NEW_TAG" ]]; then
  state_write "$NEW_TAG" "$(state_get PREVIOUS_TAG)"
else
  state_write "$NEW_TAG" "$PREV_TAG"
fi
sync_env_image_tag "$NEW_TAG"
history_append ok "$NEW_TAG" "${PREV_TAG:--}"
install_scripts
prune || warn "pruning old images/releases failed (harmless)"
log "=== DEPLOY OK: $NEW_TAG in $((SECONDS - STARTED))s (previous: ${PREV_TAG:-none}, backup: $BACKUP_PATH) ==="
