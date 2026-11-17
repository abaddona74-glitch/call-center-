#!/usr/bin/env bash
# Validates the production .env WITHOUT printing any value. Exit 1 if something must be fixed.
#
#   check-env.sh [--env /opt/callcenter/.env] [--example path/to/.env.example]
#
# Also usable on the owner's machine before copying the file to the server:
#   bash infra/server/check-env.sh --env ./prod.env --example infra/.env.example
# deploy.sh runs it before every deploy. Keep the rules in sync with apps/api/src/config/env.schema.ts.
set -euo pipefail
export LC_ALL=C
if ((BASH_VERSINFO[0] < 4)); then
  echo "check-env.sh needs bash >= 4 (macOS: brew install bash, or run it on the server)" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-${APP_DIR:-/opt/callcenter}/.env}"
EXAMPLE_FILE=""
[[ -f "$SCRIPT_DIR/../.env.example" ]] && EXAMPLE_FILE="$SCRIPT_DIR/../.env.example"
while (($#)); do
  case "$1" in
    --env)
      ENV_FILE="${2:-}"
      shift
      ;;
    --example)
      EXAMPLE_FILE="${2:-}"
      shift
      ;;
    -h | --help)
      sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 2
      ;;
  esac
  shift
done

ERRORS=0
WARNINGS=0
err() {
  echo "  ERROR  $*" >&2
  ERRORS=$((ERRORS + 1))
}
wrn() {
  echo "  warn   $*" >&2
  WARNINGS=$((WARNINGS + 1))
}

[[ -f "$ENV_FILE" ]] || {
  echo "check-env: $ENV_FILE not found" >&2
  exit 1
}
echo "check-env: $ENV_FILE" >&2

# ---------------------------------------------------------------- file permissions

perm="$(stat -c %a "$ENV_FILE" 2>/dev/null || stat -f %Lp "$ENV_FILE")"
owner="$(stat -c %U "$ENV_FILE" 2>/dev/null || stat -f %Su "$ENV_FILE")"
[[ "$perm" =~ ^[0-7]?[0-7]00$ ]] || err "file mode is $perm: must not be readable by group/others (chmod 600)"
[[ "$owner" == "$(id -un)" ]] || wrn "file is owned by '$owner', expected '$(id -un)' (chown deploy:deploy)"

# ---------------------------------------------------------------- parse (no sourcing)

declare -A VAL=() SEEN=()
strip() {
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
lineno=0
while IFS= read -r line || [[ -n "$line" ]]; do
  lineno=$((lineno + 1))
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
  if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    key="${BASH_REMATCH[2]}"
    [[ -n "${SEEN[$key]:-}" ]] && wrn "$key is defined more than once (line $lineno wins)"
    SEEN[$key]=1
    VAL[$key]="$(strip "${BASH_REMATCH[3]}")"
  else
    err "line $lineno is not KEY=VALUE"
  fi
done <"$ENV_FILE"

has() { [[ -n "${SEEN[$1]:-}" ]]; }
get() { printf '%s' "${VAL[$1]:-}"; }
set_nonempty() { [[ -n "${VAL[$1]:-}" ]]; }

is_placeholder() {
  local v="$1" r=1
  shopt -s nocasematch
  if [[ "$v" =~ ^(changeme|change_me|change-me|todo|tbd|fixme|placeholder|xxx+|\*+|\.\.\.)$ ||
    "$v" == *your_*here* || "$v" == *your-*here* || "$v" == *changeme* || "$v" == *change_me* || "$v" == *'<'*'>'* ]]; then
    r=0
  fi
  shopt -u nocasematch
  return $r
}

is_weak_secret() {
  local v="$1" r=1
  shopt -s nocasematch
  [[ "$v" =~ ^(secret|password|passw0rd|admin|admin123|root|test|example|default|qwerty|123456.*)$ ]] && r=0
  shopt -u nocasematch
  return $r
}

# ---------------------------------------------------------------- rules

# Placeholders anywhere; fatal for secrets.
for key in "${!VAL[@]}"; do
  v="${VAL[$key]}"
  [[ -n "$v" ]] || continue
  if [[ "$key" =~ (PASSWORD|SECRET|TOKEN|_KEY)$ ]]; then
    if is_placeholder "$v" || is_weak_secret "$v"; then err "$key looks like a placeholder or a well-known weak value"; fi
  elif is_placeholder "$v"; then
    wrn "$key looks like a placeholder"
  fi
done

require() { set_nonempty "$1" || err "$1 is required"; }
min_len() { # KEY N
  local v
  v="$(get "$1")"
  [[ -z "$v" || ${#v} -ge $2 ]] || err "$1 is too short (${#v} chars, need >= $2; use openssl rand -hex 32)"
}

require POSTGRES_PASSWORD
min_len POSTGRES_PASSWORD 24
pw="$(get POSTGRES_PASSWORD)"
[[ -z "$pw" || "$pw" =~ ^[A-Za-z0-9._~-]+$ ]] ||
  err "POSTGRES_PASSWORD may only contain A-Z a-z 0-9 . _ ~ - (it is embedded into DATABASE_URL)"
[[ "$pw" != callcenter ]] || err "POSTGRES_PASSWORD is the development default"
for key in POSTGRES_USER POSTGRES_DB; do
  v="$(get "$key")"
  [[ -z "$v" || "$v" =~ ^[a-z_][a-z0-9_]{0,40}$ ]] || err "$key must match ^[a-z_][a-z0-9_]*$"
done

require REGISTRY
reg="$(get REGISTRY)"
[[ -z "$reg" || "$reg" =~ ^[a-z0-9.-]+(:[0-9]+)?(/[a-z0-9._-]+)+$ ]] ||
  err "REGISTRY must look like ghcr.io/<owner> (lowercase, no trailing slash)"
tag="$(get IMAGE_TAG)"
[[ -z "$tag" || "$tag" == local || "$tag" =~ ^[0-9a-f]{40}$ ]] ||
  wrn "IMAGE_TAG is managed by deploy.sh and should be a full commit SHA"

require SITE_ADDRESS
for key in HTTP_PORT HTTPS_PORT; do
  v="$(get "$key")"
  [[ -z "$v" || "$v" =~ ^([0-9]{1,3}(\.[0-9]{1,3}){3}:)?[0-9]{1,5}$ ]] || err "$key must be PORT or IPV4:PORT"
done
site="$(get SITE_ADDRESS)"
if [[ -n "$site" && "$site" != :* && "$site" != http://* ]]; then
  host="${site#https://}"
  host="${host%%[,/ ]*}"
  host="${host%:*}"
  # A public domain: Caddy needs ports 80/443 for the Let's Encrypt challenge.
  if [[ ! "$host" =~ ^[0-9.]+$ && "$host" != localhost && "$host" != *.internal && "$host" != *.local && "$host" != *.lan ]]; then
    [[ "$(get HTTP_PORT)" =~ (^|:)80$ && "$(get HTTPS_PORT)" =~ (^|:)443$ ]] ||
      wrn "SITE_ADDRESS is a domain: set HTTP_PORT=80 and HTTPS_PORT=443 so Caddy can obtain a certificate"
  fi
fi

v="$(get COOKIE_SECURE)"
[[ "${v,,}" != false && "${v,,}" != 0 && "${v,,}" != no ]] ||
  wrn "COOKIE_SECURE is off: only acceptable for a temporary plain-HTTP test, never in production"
v="$(get LOG_LEVEL)"
[[ -z "$v" || "$v" =~ ^(fatal|error|warn|info|debug|trace)$ ]] || err "LOG_LEVEL must be fatal|error|warn|info|debug|trace"
v="$(get SESSION_TTL_HOURS)"
[[ -z "$v" || "$v" =~ ^[1-9][0-9]*$ ]] || err "SESSION_TTL_HOURS must be a positive integer"

# The API rejects an EMPTY value (min 12 chars), so the line must be absent or set.
if has BOOTSTRAP_SUPERUSER_PASSWORD; then
  v="$(get BOOTSTRAP_SUPERUSER_PASSWORD)"
  if [[ -z "$v" ]]; then
    err "BOOTSTRAP_SUPERUSER_PASSWORD is empty: the API refuses to start. Remove the line or set >= 12 chars"
  else
    min_len BOOTSTRAP_SUPERUSER_PASSWORD 12
    ((${#v} >= 16)) || wrn "BOOTSTRAP_SUPERUSER_PASSWORD: use at least 16 characters"
    wrn "BOOTSTRAP_SUPERUSER_PASSWORD is set: remove it once the superuser has logged in and changed the password"
  fi
fi

# Optional integrations: all-or-nothing groups, no root, strong passwords.
group() { # HOST_KEY KEY...
  local host_key="$1" k
  shift
  set_nonempty "$host_key" || return 0
  for k in "$@"; do set_nonempty "$k" || err "$k is required when $host_key is set"; done
}
group PBX_DB_HOST PBX_DB_USER PBX_DB_PASSWORD
group AMI_HOST AMI_USER AMI_PASSWORD
group SFTP_HOST SFTP_USER SFTP_PRIVATE_KEY_PATH
for key in PBX_DB_USER AMI_USER SFTP_USER; do
  [[ "$(get "$key")" != root ]] || err "$key must not be root (dedicated least-privilege account, see DEPLOY.md)"
done
min_len PBX_DB_PASSWORD 16
min_len AMI_PASSWORD 16
[[ "$(get PBX_DB_PASSWORD)" != cc_readonly_dev ]] || err "PBX_DB_PASSWORD is the development default"
for key in PBX_DB_PORT AMI_PORT SFTP_PORT; do
  v="$(get "$key")"
  [[ -z "$v" || "$v" =~ ^[0-9]{1,5}$ ]] || err "$key must be a port number"
done
set_nonempty PBX_DB_HOST || wrn "PBX_DB_HOST is empty: history/statistics will report 'PBX unavailable'"
set_nonempty AMI_HOST || wrn "AMI_HOST is empty: no live telephony"

v="$(get DEPLOY_EDGE_CHECK)"
[[ -z "$v" || "$v" =~ ^(auto|off)$ ]] || err "DEPLOY_EDGE_CHECK must be auto or off"
v="$(get DEPLOY_HEALTH_TIMEOUT)"
[[ -z "$v" || "$v" =~ ^[1-9][0-9]*$ ]] || err "DEPLOY_HEALTH_TIMEOUT must be a number of seconds"

# Keys a newer release added to the example but this .env does not define (defaults apply).
if [[ -n "$EXAMPLE_FILE" && -f "$EXAMPLE_FILE" ]]; then
  while IFS= read -r key; do
    [[ "$key" == IMAGE_TAG ]] && continue
    has "$key" || wrn "$key from .env.example is not set here (the default applies)"
  done < <(sed -nE 's/^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=.*/\2/p' "$EXAMPLE_FILE" | sort -u)
fi

if ((ERRORS)); then
  echo "check-env: $ERRORS error(s), $WARNINGS warning(s)" >&2
  exit 1
fi
echo "check-env: ok ($WARNINGS warning(s))" >&2
