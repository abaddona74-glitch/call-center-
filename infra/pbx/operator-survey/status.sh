#!/bin/bash
# Read-only report of the survey on this PBX: queues and their failover, what is installed, leftovers of the
# 18.11 manual setup. Changes nothing. Run as root on the PBX and send the output to the developer.
set -uo pipefail
cd "$(dirname "$0")"
. ./lib.sh
EXT_ADD=$AST/extensions_additional.conf

echo "== Asterisk"
asterisk -rx "core show version" 2>/dev/null | head -1

echo "== Очереди (queues_additional.conf)"
list_queues "$AST/queues_additional.conf"

echo "== ext-queues: строки про VQ_*/QDEST/Queue() очереди $BAHO_QUEUE"
grep -nE "^exten => $BAHO_QUEUE,.*(VQ_|QDEST|Queue\()" "$EXT_ADD" || echo "(не найдено)"
echo "  определённый failover: $(detect_failover "$EXT_ADD" "$BAHO_QUEUE" || true)"

echo "== Ручные правки в автогенерируемом extensions_additional.conf (теряются при Apply Config)"
grep -nE "gotocontinue|sub-evaluate|operator-baho" "$EXT_ADD" || echo "(нет)"

echo "== Наши блоки в *_custom.conf (строк)"
for f in extensions_custom.conf globals_custom.conf queues_post_custom.conf; do
  echo "  $f: $(block_lines "$AST/$f")"
done
echo "== Старый [sub-evaluate] в extensions_custom.conf"
sed -n '/^\[sub-evaluate\]/,/^\[/p' "$AST/extensions_custom.conf" 2>/dev/null | head -20 || true

echo "== Глобальные переменные в работе"
asterisk -rx "dialplan show globals" 2>/dev/null | grep -E "VQ_|BAHO_" || echo "(нет — опрос выключен)"
echo "== Контекст [operator-baho] в работе"
asterisk -rx "dialplan show operator-baho" 2>/dev/null | head -25

echo "== Таблица operator_baho"
mysql --defaults-extra-file="$ADMIN_CNF" asteriskcdrdb -t -e \
  "SELECT COUNT(*) AS total, SUM(rated_at >= NOW() - INTERVAL 1 DAY) AS last_24h, MAX(rated_at) AS last FROM operator_baho" \
  2>&1 || true
echo "== Права cc_readonly (новая система)"
mysql --defaults-extra-file="$ADMIN_CNF" -N -e "SELECT CONCAT(user,'@',host) FROM mysql.user WHERE user='cc_readonly'" 2>/dev/null \
  | while read -r u; do mysql --defaults-extra-file="$ADMIN_CNF" -N -e "SHOW GRANTS FOR '${u%@*}'@'${u#*@}'"; done || true
