#!/usr/bin/env bash
# Prepares a fresh VM (Ubuntu 24.04 LTS recommended, Debian 13 supported) for the call-center stack.
# Production target: a dedicated VM on the Proxmox host, in the PBX LAN, NOT the hypervisor itself.
# Run as root by the owner, from a copy of the repository's infra/ folder. Safe to re-run.
#
#   scp -r infra ccadmin@VM:/tmp/callcenter-infra          # or: git clone, then cd infra
#   sudo ADMIN_IPS="192.168.0.10,192.168.0.11" bash /tmp/callcenter-infra/server/bootstrap.sh \
#       --admin-user ccadmin --admin-keys /tmp/admin_keys.pub \
#       --runner-user --ci-key /tmp/ci_deploy.pub --ci-key-from 127.0.0.1,::1 --swap 2G --upgrade
#
# Options
#   --admin-user NAME     sudo-capable admin login (default: ccadmin). May be an existing user (e.g. ubuntu).
#   --admin-keys FILE     authorized_keys lines for the admin user (required unless it already has keys)
#   --ci-key FILE         public key of the GitHub Actions deploy key -> user `deploy` (gets "restrict")
#   --ci-key-from LIST    also restrict that key to these source addresses (from="..."), e.g.
#                         127.0.0.1,::1 when the self-hosted runner lives on this VM (recommended)
#   --runner-user         create user gha-runner for a self-hosted GitHub Actions runner (no sudo,
#                         no docker group, no SSH login) and install git; registration is manual
#   --swap SIZE           create /swapfile of SIZE (e.g. 2G) if the VM has no swap (small-RAM VMs)
#   --admin-ips LIST      comma list of IPs/CIDRs allowed to SSH (or env ADMIN_IPS). Required.
#   --ssh-port N          port sshd already listens on (default 22; this script does not change it)
#   --timezone TZ         system timezone (default UTC; the app uses Asia/Tashkent from its own config)
#   --reboot-time HH:MM   let unattended-upgrades reboot at this time (server time, i.e. UTC) when a
#                         security update needs it. Default: never reboot automatically.
#   --sudo-nopasswd       admin gets passwordless sudo (default: sudo asks for the admin's password)
#   --fail2ban            install fail2ban for sshd
#   --upgrade             apt-get upgrade the system first (recommended on the first run)
#   --skip-firewall       do not touch ufw (e.g. a provider firewall is used instead)
#   --force               allow other OS releases / an SSH client IP outside ADMIN_IPS
#
# What it does: base packages, timezone + NTP, users `deploy` (key-only, docker group, no sudo) and
# the admin (key-only SSH, sudo), sshd hardening drop-in (validated with `sshd -t`), Docker Engine +
# compose plugin from Docker's apt repo (GPG fingerprint checked), Docker log rotation, ufw (deny in,
# SSH only from ADMIN_IPS, 80/443 open), unattended security upgrades, journald limits, logrotate,
# /opt/callcenter layout (.env from the example, mode 600), the backup systemd timer.
# It does NOT start the application: deploys come from the GitHub workflow. Runbook: docs/rewrite/DEPLOY.md
set -euo pipefail
export LC_ALL=C DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR=/opt/callcenter
DEPLOY_USER=deploy
RUNNER_USER=gha-runner
DOCKER_GPG_FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
SSHD_DROPIN=/etc/ssh/sshd_config.d/00-callcenter-hardening.conf

ADMIN_USER=ccadmin
ADMIN_KEYS=""
CI_KEY=""
CI_KEY_FROM=""
RUNNER=0
SWAP_SIZE=""
OS_ID=""
OS_CODENAME=""
ADMIN_IPS="${ADMIN_IPS:-}"
SSH_PORT=22
TIMEZONE=UTC
REBOOT_TIME=""
SUDO_NOPASSWD=0
FAIL2BAN=0
UPGRADE=0
SKIP_FIREWALL=0
FORCE=0
SUMMARY=()

log() { printf '\n==> %s\n' "$*"; }
note() {
  printf '    %s\n' "$*"
  SUMMARY+=("$*")
}
die() {
  printf '\nERROR: %s\n' "$*" >&2
  exit 1
}

parse_args() {
  while (($#)); do
    case "$1" in
      --admin-user) ADMIN_USER="${2:?}" && shift ;;
      --admin-keys) ADMIN_KEYS="${2:?}" && shift ;;
      --ci-key) CI_KEY="${2:?}" && shift ;;
      --ci-key-from) CI_KEY_FROM="${2:?}" && shift ;;
      --runner-user) RUNNER=1 ;;
      --swap) SWAP_SIZE="${2:?}" && shift ;;
      --admin-ips) ADMIN_IPS="${2:?}" && shift ;;
      --ssh-port) SSH_PORT="${2:?}" && shift ;;
      --timezone) TIMEZONE="${2:?}" && shift ;;
      --reboot-time) REBOOT_TIME="${2:?}" && shift ;;
      --sudo-nopasswd) SUDO_NOPASSWD=1 ;;
      --fail2ban) FAIL2BAN=1 ;;
      --upgrade) UPGRADE=1 ;;
      --skip-firewall) SKIP_FIREWALL=1 ;;
      --force) FORCE=1 ;;
      -h | --help)
        sed -n '2,39p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
        exit 0
        ;;
      *) die "unknown argument: $1 (see --help)" ;;
    esac
    shift
  done
}

pkg_installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }

# install_if_changed SRC DST MODE: returns 0 if DST was (re)written.
install_if_changed() {
  if [[ -f "$2" ]] && cmp -s "$1" "$2"; then return 1; fi
  install -m "$3" "$1" "$2"
}

ip4_to_int() {
  local IFS=. a b c d
  read -r a b c d <<<"$1"
  echo $(((a << 24) + (b << 16) + (c << 8) + d))
}
ip4_in_cidr() { # IP CIDR
  local ip="$1" cidr="$2" net bits mask a b
  [[ "$cidr" == */* ]] || cidr="$cidr/32"
  net="${cidr%/*}"
  bits="${cidr#*/}"
  [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ && "$net" =~ ^[0-9]+(\.[0-9]+){3}$ && "$bits" =~ ^[0-9]+$ ]] || return 1
  ((bits <= 32)) || return 1
  mask=$(((bits == 0) ? 0 : ((0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF)))
  a=$(ip4_to_int "$ip")
  b=$(ip4_to_int "$net")
  (((a & mask) == (b & mask)))
}

current_client_ip() {
  local ip=""
  if [[ -n "${SSH_CONNECTION:-}" ]]; then
    ip="${SSH_CONNECTION%% *}"
  else
    # under sudo SSH_CONNECTION is dropped; `who -m` shows the origin of this terminal
    ip="$(who -m 2>/dev/null | sed -nE 's/.*\(([^)]+)\).*/\1/p' | head -n 1)"
  fi
  printf '%s' "$ip"
}

add_key_line() { # FILE LINE: append if not present
  grep -qxF "$2" "$1" 2>/dev/null || printf '%s\n' "$2" >>"$1"
}

# set_key_line FILE LINE: like add_key_line, but first drops other lines with the same key blob,
# so changed options (restrict, from=...) converge on re-runs.
set_key_line() {
  local file="$1" line="$2" blob tmp
  blob="$(grep -oE '(ssh-[a-z0-9-]+|ecdsa-[a-z0-9-]+|sk-[a-z0-9@.-]+) [A-Za-z0-9+/=]+' <<<"$line" | head -n 1)"
  [[ -n "$blob" ]] || return 1
  tmp="$(mktemp)"
  grep -vF "$blob" "$file" >"$tmp" || true
  printf '%s\n' "$line" >>"$tmp"
  cat "$tmp" >"$file"
  rm -f "$tmp"
}

valid_pubkey_line() {
  local tmp rc=0
  tmp="$(mktemp)"
  printf '%s\n' "$1" >"$tmp"
  ssh-keygen -l -f "$tmp" >/dev/null 2>&1 || rc=1
  rm -f "$tmp"
  return $rc
}

# ---------------------------------------------------------------- steps

preflight() {
  log "Preflight"
  ((EUID == 0)) || die "run as root (sudo -i)"
  # shellcheck disable=SC1091
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
  case "${ID:-}:${VERSION_ID:-}" in
    ubuntu:24.04 | debian:13) ;;
    *)
      ((FORCE)) || die "expected Ubuntu 24.04 LTS or Debian 13, found ${PRETTY_NAME:-unknown} (--force to continue)"
      echo "    WARNING: untested OS ${PRETTY_NAME:-unknown}, continuing because of --force"
      ;;
  esac
  [[ "$OS_ID" == ubuntu || "$OS_ID" == debian ]] || die "only Ubuntu/Debian are supported (Docker apt repo)"
  if pgrep -x pveproxy >/dev/null 2>&1 || [[ -d /etc/pve ]]; then
    die "this looks like the Proxmox hypervisor itself. Run the stack in a dedicated VM, never on the host."
  fi
  [[ -z "$CI_KEY_FROM" || "$CI_KEY_FROM" =~ ^[0-9A-Fa-f.:/,*]+$ ]] || die "--ci-key-from: comma list of IPs/CIDRs"
  [[ -z "$SWAP_SIZE" || "$SWAP_SIZE" =~ ^[1-9][0-9]*[MG]$ ]] || die "--swap: size like 2G or 1536M"
  [[ "$ADMIN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ && "$ADMIN_USER" != root && "$ADMIN_USER" != "$DEPLOY_USER" ]] ||
    die "--admin-user must be a valid user name other than root/$DEPLOY_USER"
  [[ "$SSH_PORT" =~ ^[0-9]+$ ]] || die "--ssh-port must be a number"
  [[ -z "$REBOOT_TIME" || "$REBOOT_TIME" =~ ^([01][0-9]|2[0-3]):[0-5][0-9]$ ]] || die "--reboot-time must be HH:MM"
  [[ -z "$ADMIN_KEYS" || -r "$ADMIN_KEYS" ]] || die "cannot read --admin-keys $ADMIN_KEYS"
  [[ -z "$CI_KEY" || -r "$CI_KEY" ]] || die "cannot read --ci-key $CI_KEY"
  if [[ -n "${SUDO_USER:-}" && "$SUDO_USER" != root && "$SUDO_USER" != "$ADMIN_USER" ]]; then
    die "you are logged in as '$SUDO_USER', who will NOT be allowed to SSH in after hardening (AllowUsers).
       Re-run with --admin-user $SUDO_USER, or log in as root/$ADMIN_USER."
  fi
  if ((!SKIP_FIREWALL)); then
    ADMIN_IPS="${ADMIN_IPS// /}"
    [[ -n "$ADMIN_IPS" ]] || die "ADMIN_IPS is empty: refusing to enable the firewall (you would lock yourself out).
       Pass --admin-ips 'IP[,CIDR...]' or ADMIN_IPS=..., or --skip-firewall."
  fi
  [[ -f "$SCRIPT_DIR/systemd/callcenter-backup.service" && -f "$INFRA_DIR/.env.example" ]] ||
    die "run this script from a full copy of the repository's infra/ folder"
}

apt_base() {
  log "Base packages"
  apt-get update -q
  if ((UPGRADE)); then
    apt-get -yq -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
  fi
  local pkgs=(ca-certificates curl gnupg sudo ufw unattended-upgrades apt-listchanges logrotate openssh-server util-linux)
  ((FAIL2BAN)) && pkgs+=(fail2ban)
  ((RUNNER)) && pkgs+=(git tar)
  # NTP client: keep chrony/ntpsec if present, otherwise systemd-timesyncd (not always installed on Debian)
  if ! pkg_installed chrony && ! pkg_installed ntpsec && ! pkg_installed ntp; then pkgs+=(systemd-timesyncd); fi
  # Proxmox/KVM guest: lets the host shut the VM down cleanly and freeze the FS for vzdump backups
  [[ "$(systemd-detect-virt 2>/dev/null || true)" == kvm ]] && pkgs+=(qemu-guest-agent)
  apt-get install -yq --no-install-recommends "${pkgs[@]}"
  if pkg_installed qemu-guest-agent; then systemctl enable --now qemu-guest-agent >/dev/null 2>&1 || true; fi
}

set_time() {
  log "Timezone and NTP"
  timedatectl set-timezone "$TIMEZONE"
  timedatectl set-ntp true || true
  note "timezone: $TIMEZONE, NTP: $(timedatectl show -p NTP --value 2>/dev/null || echo '?'), synchronized: $(timedatectl show -p NTPSynchronized --value 2>/dev/null || echo '?')"
}

ensure_user() { # NAME
  local name="$1"
  if ! id "$name" >/dev/null 2>&1; then
    useradd --create-home --shell /bin/bash --user-group "$name"
    # "*" = no password at all (not "!"/locked): key login works, password login is impossible.
    usermod -p '*' "$name"
    echo "    created user $name"
  fi
  install -d -m 700 -o "$name" -g "$name" "/home/$name/.ssh"
  touch "/home/$name/.ssh/authorized_keys"
  chown "$name:$name" "/home/$name/.ssh/authorized_keys"
  chmod 600 "/home/$name/.ssh/authorized_keys"
}

users_and_keys() {
  log "Users"
  ensure_user "$DEPLOY_USER"
  ensure_user "$ADMIN_USER"
  usermod -aG sudo "$ADMIN_USER"

  local line n=0
  if [[ -n "$ADMIN_KEYS" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
      valid_pubkey_line "$line" || die "invalid public key line in $ADMIN_KEYS: ${line:0:40}..."
      add_key_line "/home/$ADMIN_USER/.ssh/authorized_keys" "$line"
      n=$((n + 1))
    done <"$ADMIN_KEYS"
    ((n > 0)) || die "$ADMIN_KEYS contains no keys"
  fi
  grep -qE '^(ssh-|ecdsa-|sk-)' "/home/$ADMIN_USER/.ssh/authorized_keys" ||
    die "$ADMIN_USER has no SSH keys: pass --admin-keys FILE (otherwise nobody can log in after hardening)"
  note "admin user: $ADMIN_USER ($(grep -cE '^(ssh-|ecdsa-|sk-)' "/home/$ADMIN_USER/.ssh/authorized_keys") key(s), sudo)"

  if [[ -n "$CI_KEY" ]]; then
    line="$(grep -vE '^[[:space:]]*(#|$)' "$CI_KEY" | head -n 1)"
    valid_pubkey_line "$line" || die "invalid public key in $CI_KEY"
    # "restrict": no port/agent/X11 forwarding, no pty. Commands and scp/sftp still work.
    # from="...": the key only works from these addresses (loopback when the runner is on this VM).
    if [[ "$line" =~ ^(ssh-|ecdsa-|sk-) ]]; then
      if [[ -n "$CI_KEY_FROM" ]]; then line="restrict,from=\"$CI_KEY_FROM\" $line"; else line="restrict $line"; fi
    fi
    set_key_line "/home/$DEPLOY_USER/.ssh/authorized_keys" "$line"
  fi
  note "deploy user: $DEPLOY_USER (no password, no sudo, docker group; $(grep -c . "/home/$DEPLOY_USER/.ssh/authorized_keys") CI key(s)${CI_KEY_FROM:+, from=$CI_KEY_FROM})"

  if ((RUNNER)); then
    if ! id "$RUNNER_USER" >/dev/null 2>&1; then
      useradd --create-home --shell /bin/bash --user-group "$RUNNER_USER"
      usermod -p '*' "$RUNNER_USER"
    fi
    gpasswd -d "$RUNNER_USER" docker >/dev/null 2>&1 || true
    gpasswd -d "$RUNNER_USER" sudo >/dev/null 2>&1 || true
    note "runner user: $RUNNER_USER (no sudo, no docker, not in AllowUsers). Register the runner by hand: DEPLOY.md"
  fi

  local sudoers=/etc/sudoers.d/90-callcenter-admin
  if ((SUDO_NOPASSWD)); then
    local tmp
    tmp="$(mktemp)"
    printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$ADMIN_USER" >"$tmp"
    visudo -cf "$tmp" >/dev/null || die "generated sudoers entry is invalid"
    install -m 440 "$tmp" "$sudoers"
    rm -f "$tmp"
    note "sudo: passwordless for $ADMIN_USER"
  else
    rm -f "$sudoers"
    if [[ "$(getent shadow "$ADMIN_USER" | cut -d: -f2)" != \$* ]]; then
      if [[ -t 0 ]]; then
        echo "    $ADMIN_USER needs a password for sudo (SSH stays key-only). Set it now:"
        passwd "$ADMIN_USER"
      fi
      [[ "$(getent shadow "$ADMIN_USER" | cut -d: -f2)" == \$* ]] ||
        die "$ADMIN_USER has no password, so sudo would be impossible after root login is disabled.
       Run 'passwd $ADMIN_USER' and re-run, or use --sudo-nopasswd."
    fi
    note "sudo: $ADMIN_USER with password"
    if grep -qs "^$ADMIN_USER .*NOPASSWD" /etc/sudoers.d/90-cloud-init-users; then
      note "WARNING: /etc/sudoers.d/90-cloud-init-users still gives $ADMIN_USER passwordless sudo."
      note "  Delete it once 'sudo -k; sudo true' asks for the password and works."
    fi
  fi
}

harden_sshd() {
  log "sshd hardening"
  grep -qE '^[[:space:]]*Include[[:space:]]+/etc/ssh/sshd_config\.d/\*\.conf' /etc/ssh/sshd_config ||
    die "/etc/ssh/sshd_config does not include sshd_config.d/*.conf"
  local tmp backup=""
  tmp="$(mktemp)"
  cat >"$tmp" <<EOF
# Managed by infra/server/bootstrap.sh (call-center). Re-run bootstrap instead of editing.
# The first value of a keyword wins in sshd, and this file is read before the others.
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitEmptyPasswords no
PubkeyAuthentication yes
AuthenticationMethods publickey
AllowUsers $ADMIN_USER $DEPLOY_USER
X11Forwarding no
AllowAgentForwarding no
AllowTcpForwarding no
PermitTunnel no
MaxAuthTries 3
LoginGraceTime 30
ClientAliveInterval 300
ClientAliveCountMax 2
EOF
  if [[ -f "$SSHD_DROPIN" ]] && cmp -s "$tmp" "$SSHD_DROPIN"; then
    rm -f "$tmp"
    note "sshd: hardening already in place"
    return 0
  fi
  if [[ -f "$SSHD_DROPIN" ]]; then
    backup="$(mktemp)"
    cp -p "$SSHD_DROPIN" "$backup"
  fi
  install -m 644 "$tmp" "$SSHD_DROPIN"
  rm -f "$tmp"
  mkdir -p /run/sshd
  if ! sshd -t; then
    if [[ -n "$backup" ]]; then mv -f "$backup" "$SSHD_DROPIN"; else rm -f "$SSHD_DROPIN"; fi
    die "sshd -t rejected the configuration; previous state restored, sshd not reloaded"
  fi
  local eff
  eff="$(sshd -T -C "user=$DEPLOY_USER,host=localhost,addr=127.0.0.1")"
  if ! grep -qx 'permitrootlogin no' <<<"$eff" || ! grep -qx 'passwordauthentication no' <<<"$eff" ||
    ! grep -qx 'kbdinteractiveauthentication no' <<<"$eff"; then
    die "effective sshd settings differ from the drop-in (another file overrides it?): check 'sshd -T'"
  fi
  systemctl reload ssh.service 2>/dev/null || systemctl restart ssh.service
  rm -f "$backup"
  note "sshd: root login off, passwords off, AllowUsers $ADMIN_USER $DEPLOY_USER"
  echo "    KEEP THIS SESSION OPEN and test a new login in another terminal: ssh $ADMIN_USER@<server>"
}

install_docker() {
  log "Docker Engine (official apt repository)"
  local p
  for p in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    if pkg_installed "$p"; then
      echo "    removing conflicting package $p"
      apt-get remove -yq "$p"
    fi
  done
  install -m 0755 -d /etc/apt/keyrings
  local key=/etc/apt/keyrings/docker.asc tmp fpr
  tmp="$(mktemp)"
  curl -fsSL "https://download.docker.com/linux/$OS_ID/gpg" -o "$tmp"
  fpr="$(gpg --show-keys --with-colons "$tmp" 2>/dev/null | awk -F: '/^fpr:/ { print $10; exit }')"
  [[ "$fpr" == "$DOCKER_GPG_FPR" ]] || die "Docker GPG key fingerprint mismatch (got '$fpr')"
  install -m 0644 "$tmp" "$key"
  rm -f "$tmp"
  if [[ -f /etc/apt/sources.list.d/docker.list ]]; then
    echo "    keeping existing /etc/apt/sources.list.d/docker.list"
  else
    cat >/etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$OS_ID
Suites: $OS_CODENAME
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: $key
EOF
  fi
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  local daemon=/etc/docker/daemon.json
  tmp="$(mktemp)"
  cat >"$tmp" <<'EOF'
{
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" },
  "live-restore": true
}
EOF
  mkdir -p /etc/docker
  if [[ ! -f "$daemon" ]]; then
    install -m 644 "$tmp" "$daemon"
    systemctl restart docker
    note "docker: log rotation (local driver, 5 x 20 MB per container), live-restore"
  elif cmp -s "$tmp" "$daemon"; then
    note "docker: daemon.json already in place"
  else
    echo "    WARNING: $daemon exists and differs; not overwriting. Recommended content:"
    sed 's/^/      /' "$tmp"
    note "docker: daemon.json left as is (review it)"
  fi
  rm -f "$tmp"
  systemctl enable --now docker containerd >/dev/null
  usermod -aG docker "$DEPLOY_USER"
  note "docker: $(docker --version), $(docker compose version)"
}

configure_firewall() {
  if ((SKIP_FIREWALL)); then
    note "ufw: skipped (--skip-firewall)"
    return 0
  fi
  log "Firewall (ufw)"
  local ip client covered=0 list=()
  IFS=, read -r -a list <<<"$ADMIN_IPS"
  for ip in "${list[@]}"; do
    [[ -n "$ip" ]] || continue
    ufw --dry-run allow from "$ip" to any port "$SSH_PORT" proto tcp >/dev/null 2>&1 || die "invalid address in ADMIN_IPS: $ip"
  done
  client="$(current_client_ip)"
  if [[ -n "$client" ]]; then
    for ip in "${list[@]}"; do
      if [[ "$client" == "$ip" ]] || ip4_in_cidr "$client" "$ip"; then covered=1; fi
    done
    if ((!covered)); then
      ((FORCE)) || die "your SSH client address $client is not in ADMIN_IPS: enabling ufw would cut you off (use --force if you have console access)"
      echo "    WARNING: $client is not in ADMIN_IPS (continuing because of --force)"
    fi
  else
    echo "    WARNING: cannot determine your SSH client address; make sure it is in ADMIN_IPS"
  fi
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  for ip in "${list[@]}"; do
    [[ -n "$ip" ]] || continue
    ufw allow from "$ip" to any port "$SSH_PORT" proto tcp comment 'callcenter admin ssh' >/dev/null
  done
  ufw allow 80/tcp comment 'callcenter http' >/dev/null
  ufw allow 443/tcp comment 'callcenter https' >/dev/null
  ufw --force enable >/dev/null
  note "ufw: deny incoming; ssh/$SSH_PORT from $ADMIN_IPS; 80,443 open. Stale admin IPs are NOT removed: ufw status numbered"
  note "ufw: ports published by Docker bypass ufw. Only the web container publishes ports (HTTP_PORT/HTTPS_PORT)."
}

configure_unattended() {
  log "Unattended security upgrades"
  cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF
  # Origins stay the distribution default (security updates only). Docker's repo is not in it:
  # Docker Engine is upgraded deliberately by an admin.
  local reboot=false time=04:00
  if [[ -n "$REBOOT_TIME" ]]; then
    reboot=true
    time="$REBOOT_TIME"
  fi
  cat >/etc/apt/apt.conf.d/52callcenter-unattended-upgrades <<EOF
// Managed by infra/server/bootstrap.sh
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Automatic-Reboot "$reboot";
Unattended-Upgrade::Automatic-Reboot-Time "$time";
EOF
  systemctl enable --now unattended-upgrades apt-daily.timer apt-daily-upgrade.timer >/dev/null 2>&1 || true
  if [[ "$reboot" == true ]]; then
    note "unattended-upgrades: security only, automatic reboot at $time server time ($TIMEZONE) when required"
  else
    note "unattended-upgrades: security only, NO automatic reboot (check /var/run/reboot-required)"
  fi
}

configure_fail2ban() {
  ((FAIL2BAN)) || return 0
  log "fail2ban"
  local ignore="127.0.0.1/8 ::1 ${ADMIN_IPS//,/ }"
  cat >/etc/fail2ban/jail.d/callcenter-sshd.local <<EOF
# Managed by infra/server/bootstrap.sh
[sshd]
enabled = true
backend = systemd
port = $SSH_PORT
maxretry = 5
findtime = 10m
bantime = 1h
ignoreip = $ignore
EOF
  systemctl enable fail2ban >/dev/null
  systemctl restart fail2ban
  note "fail2ban: sshd jail enabled"
}

configure_swap() {
  [[ -n "$SWAP_SIZE" ]] || return 0
  log "Swap"
  if [[ -n "$(swapon --show --noheadings 2>/dev/null)" ]]; then
    note "swap: already active ($(swapon --show --noheadings | awk '{ print $1, $3 }' | tr '\n' ' '))"
    return 0
  fi
  if [[ ! -f /swapfile ]]; then
    fallocate -l "$SWAP_SIZE" /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
  grep -qE '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo 'vm.swappiness=10' >/etc/sysctl.d/90-callcenter-swap.conf
  sysctl -q -p /etc/sysctl.d/90-callcenter-swap.conf || true
  note "swap: /swapfile $SWAP_SIZE, swappiness 10"
}

configure_logs() {
  log "journald and logrotate"
  mkdir -p /etc/systemd/journald.conf.d
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp" <<'EOF'
# Managed by infra/server/bootstrap.sh
[Journal]
Storage=persistent
SystemMaxUse=1G
SystemKeepFree=2G
MaxRetentionSec=3month
EOF
  if install_if_changed "$tmp" /etc/systemd/journald.conf.d/90-callcenter.conf 644; then
    systemctl restart systemd-journald
  fi
  cat >"$tmp" <<EOF
# Managed by infra/server/bootstrap.sh
$APP_DIR/logs/*.log {
    weekly
    rotate 12
    compress
    delaycompress
    missingok
    notifempty
    su $DEPLOY_USER $DEPLOY_USER
    create 0640 $DEPLOY_USER $DEPLOY_USER
}
EOF
  install_if_changed "$tmp" /etc/logrotate.d/callcenter 644 || true
  rm -f "$tmp"
  note "logs: journald max 1G / 3 months; $APP_DIR/logs rotated weekly (12); containers: docker local driver"
}

setup_app_dir() {
  log "$APP_DIR"
  local d
  install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
  for d in bin releases logs hooks; do
    install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/$d"
  done
  for d in backups backups/daily backups/weekly backups/pre-deploy backups/manual secrets; do
    install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/$d"
  done
  local f
  for f in lib.sh deploy.sh backup.sh restore.sh check-env.sh; do
    install -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SCRIPT_DIR/$f" "$APP_DIR/bin/$f"
  done
  install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$INFRA_DIR/.env.example" "$APP_DIR/.env.example"
  [[ -f "$APP_DIR/compose.yml" ]] ||
    install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$INFRA_DIR/compose.yml" "$APP_DIR/compose.yml"
  [[ -f "$APP_DIR/compose.override.yml" ]] ||
    install -m 640 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$SCRIPT_DIR/compose.override.yml" "$APP_DIR/compose.override.yml"
  if [[ ! -f "$APP_DIR/.env" ]]; then
    install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$INFRA_DIR/.env.example" "$APP_DIR/.env"
    note ".env: created from .env.example — FILL IT IN: sudo -u $DEPLOY_USER nano $APP_DIR/.env"
  else
    note ".env: exists (left untouched)"
  fi
  chown "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
}

install_units() {
  log "systemd: backup timer"
  local u changed=0
  for u in callcenter-backup.service callcenter-backup.timer; do
    install_if_changed "$SCRIPT_DIR/systemd/$u" "/etc/systemd/system/$u" 644 && changed=1
  done
  ((changed)) && systemctl daemon-reload
  systemctl enable --now callcenter-backup.timer >/dev/null
  note "backups: $(systemctl list-timers callcenter-backup.timer --no-pager 2>/dev/null | awk 'NR == 2 { print "next run " $1, $2, $3 }')"
}

summary() {
  log "Summary"
  printf '    %s\n' "${SUMMARY[@]}"
  [[ -f /var/run/reboot-required ]] && echo "    A reboot is required (kernel/libc update): sudo reboot"
  cat <<EOF

Next steps (docs/rewrite/DEPLOY.md):
  1. In ANOTHER terminal check that you can still log in: ssh $ADMIN_USER@<vm>   (root login is now off)
  2. Fill in $APP_DIR/.env, then: sudo -u $DEPLOY_USER $APP_DIR/bin/check-env.sh
  3. Self-hosted runner (if --runner-user): register it as $RUNNER_USER with label callcenter-deploy.
  4. GitHub: environment "production" with required reviewers and secrets DEPLOY_HOST, DEPLOY_PORT,
     DEPLOY_SSH_KEY, DEPLOY_KNOWN_HOSTS (runner on this VM: DEPLOY_HOST=127.0.0.1 and
     ssh-keyscan -t ed25519 -p $SSH_PORT 127.0.0.1). Host key fingerprint to compare:
     $(ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub 2>/dev/null || echo 'ssh-keygen -lf /etc/ssh/ssh_host_*_key.pub')
  5. Kerio: forward only TCP 443 (Internet) -> this VM:443. Run the "Deploy" workflow and approve it.
EOF
}

main() {
  parse_args "$@"
  preflight
  apt_base
  set_time
  configure_swap
  users_and_keys
  install_docker
  setup_app_dir
  install_units
  configure_unattended
  configure_fail2ban
  configure_logs
  harden_sshd
  configure_firewall
  summary
}

[[ "${BASH_SOURCE[0]}" == "$0" ]] && main "$@"
