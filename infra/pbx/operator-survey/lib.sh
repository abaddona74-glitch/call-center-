# lib.sh — shared part of install.sh, backup.sh, status.sh, verify.sh (runs on the PBX as root).
# MySQL credentials go into temporary option files, so passwords never show up in `ps` output.
# shellcheck shell=bash
. "$(dirname "${BASH_SOURCE[0]}")/lib-conf.sh"

mk_cnf() {
  local f; f=$(mktemp); chmod 600 "$f"
  printf '[client]\nuser="%s"\npassword="%s"\n' "$1" "$2" > "$f"
  echo "$f"
}
AMPUSER=$(sed -n 's/^AMPDBUSER=//p' /etc/amportal.conf | head -1 | tr -d "\"'")
AMPUSER=${AMPUSER:-asteriskuser}
AMPPASS=$(sed -n 's/^AMPDBPASS=//p' /etc/amportal.conf | head -1 | tr -d "\"'")
ROOTPASS=$(sed -n 's/^mysqlrootpwd=//p' /etc/issabel.conf 2>/dev/null | head -1 | tr -d "\"'" || true)
AMP_CNF=$(mk_cnf "$AMPUSER" "$AMPPASS")                     # the AGI writes with this user
if [ -n "$ROOTPASS" ]; then ADMIN_CNF=$(mk_cnf root "$ROOTPASS"); else ADMIN_CNF=$AMP_CNF; fi
trap 'rm -f "$AMP_CNF" "$ADMIN_CNF"' EXIT
AST=${AST:-/etc/asterisk}
# The survey queue (IVR ivr-4 -> queue 2020159 on this PBX).
BAHO_QUEUE=${BAHO_QUEUE:-2020159}
