# lib.sh — backup.sh va install.sh uchun umumiy qism.
# MySQL parollari buyruq qatorida ko'rinmasligi uchun vaqtinchalik option-fayllar yaratiladi.
mk_cnf() {
  local f; f=$(mktemp); chmod 600 "$f"
  printf '[client]\nuser="%s"\npassword="%s"\n' "$1" "$2" > "$f"
  echo "$f"
}
AMPUSER=$(sed -n 's/^AMPDBUSER=//p' /etc/amportal.conf | head -1 | tr -d "\"'")
AMPUSER=${AMPUSER:-asteriskuser}
AMPPASS=$(sed -n 's/^AMPDBPASS=//p' /etc/amportal.conf | head -1 | tr -d "\"'")
ROOTPASS=$(sed -n 's/^mysqlrootpwd=//p' /etc/issabel.conf 2>/dev/null | head -1 | tr -d "\"'" || true)
AMP_CNF=$(mk_cnf "$AMPUSER" "$AMPPASS")                     # AGI shu foydalanuvchi bilan yozadi
if [ -n "$ROOTPASS" ]; then ADMIN_CNF=$(mk_cnf root "$ROOTPASS"); else ADMIN_CNF=$AMP_CNF; fi
trap 'rm -f "$AMP_CNF" "$ADMIN_CNF"' EXIT
AST=/etc/asterisk
MARK='==== OPERATOR-BAHO BOSHI ===='
